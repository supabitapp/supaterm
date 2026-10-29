import * as Electron from "electron";
import type { FieldType } from "ffi-rs";

const DOCK_ICON_POINTS = 128;
const PNG_BITMAP_FILE_TYPE = 4n;

export async function loadMacApplicationIcon() {
  const { DataType, load, open } = await import("ffi-rs");
  const objc = "supaterm-dock-icon-objc";
  const system = "supaterm-dock-icon-system";
  open({ library: objc, path: "/usr/lib/libobjc.A.dylib" });
  open({ library: system, path: "/usr/lib/libSystem.B.dylib" });

  const findClass = (name: string) =>
    load({
      library: objc,
      funcName: "objc_getClass",
      retType: DataType.BigInt,
      paramsType: [DataType.String],
      paramsValue: [name],
    }) as bigint;
  const selector = (name: string) =>
    load({
      library: objc,
      funcName: "sel_registerName",
      retType: DataType.BigInt,
      paramsType: [DataType.String],
      paramsValue: [name],
    }) as bigint;
  const send = (
    receiver: bigint,
    name: string,
    paramsType: FieldType[] = [],
    paramsValue: unknown[] = [],
  ) =>
    load({
      library: objc,
      funcName: "objc_msgSend",
      retType: DataType.BigInt,
      paramsType: [DataType.BigInt, DataType.BigInt, ...paramsType],
      paramsValue: [receiver, selector(name), ...paramsValue],
    }) as bigint;
  const sendVoid = (
    receiver: bigint,
    name: string,
    paramsType: FieldType[] = [],
    paramsValue: unknown[] = [],
  ) => {
    load({
      library: objc,
      funcName: "objc_msgSend",
      retType: DataType.Void,
      paramsType: [DataType.BigInt, DataType.BigInt, ...paramsType],
      paramsValue: [receiver, selector(name), ...paramsValue],
    });
  };

  const stringClass = findClass("NSString");
  const string = (value: string) =>
    send(stringClass, "stringWithUTF8String:", [DataType.String], [value]);
  const source = send(
    findClass("NSImage"),
    "imageNamed:",
    [DataType.BigInt],
    [string("NSApplicationIcon")],
  );
  if (source === 0n) throw new Error("The native application icon is unavailable.");
  const bitmapClass = findClass("NSBitmapImageRep");
  const dictionaryClass = findClass("NSDictionary");
  const properties = send(dictionaryClass, "dictionary");
  const transformClass = findClass("NSAffineTransform");
  const transformHint = string("NSImageHintCTM");

  const result = [];
  for (const scaleFactor of [1, 2]) {
    const size = DOCK_ICON_POINTS * scaleFactor;
    const rect = Buffer.from(new Float64Array([0, 0, DOCK_ICON_POINTS, DOCK_ICON_POINTS]).buffer);
    const transform = send(transformClass, "transform");
    sendVoid(transform, "scaleBy:", [DataType.Double], [scaleFactor]);
    const hints = send(
      dictionaryClass,
      "dictionaryWithObject:forKey:",
      [DataType.BigInt, DataType.BigInt],
      [transform, transformHint],
    );
    let bitmap = 0n;
    try {
      const cgImage = send(
        source,
        "CGImageForProposedRect:context:hints:",
        [DataType.U8Array, DataType.BigInt, DataType.BigInt],
        [rect, 0n, hints],
      );
      if (cgImage === 0n) throw new Error("The native application icon could not be rendered.");
      bitmap = send(send(bitmapClass, "alloc"), "initWithCGImage:", [DataType.BigInt], [cgImage]);
      const data = send(
        bitmap,
        "representationUsingType:properties:",
        [DataType.BigInt, DataType.BigInt],
        [PNG_BITMAP_FILE_TYPE, properties],
      );
      const length = send(data, "length");
      if (length === 0n) throw new Error("The native application icon could not be encoded.");
      const buffer = Buffer.alloc(Number(length));
      load({
        library: system,
        funcName: "memcpy",
        retType: DataType.BigInt,
        paramsType: [DataType.U8Array, DataType.BigInt, DataType.BigInt],
        paramsValue: [buffer, send(data, "bytes"), length],
      });
      const image = Electron.nativeImage.createFromBuffer(buffer);
      if (image.isEmpty() || image.getSize().width !== size || image.getSize().height !== size) {
        throw new Error("The native application icon has an unexpected size.");
      }
      result.push({ size, scaleFactor, bitmap: image.toBitmap() });
    } finally {
      if (bitmap !== 0n) sendVoid(bitmap, "release");
    }
  }
  return result;
}
