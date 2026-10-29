import { nativeImage } from "electron";
import type { FieldType } from "ffi-rs";

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

  const name = send(
    findClass("NSString"),
    "stringWithUTF8String:",
    [DataType.String],
    ["NSApplicationIcon"],
  );
  const source = send(findClass("NSImage"), "imageNamed:", [DataType.BigInt], [name]);
  if (source === 0n) throw new Error("The native application icon is unavailable.");
  const bitmapClass = findClass("NSBitmapImageRep");
  const properties = send(findClass("NSDictionary"), "dictionary");

  const result = nativeImage.createEmpty();
  for (const scaleFactor of [1, 2]) {
    const size = 128 * scaleFactor;
    const image = send(source, "copy");
    let bitmap = 0n;
    try {
      sendVoid(
        image,
        "setSize:",
        [{ width: DataType.Double, height: DataType.Double, ffiTypeTag: DataType.StackStruct }],
        [{ width: size, height: size }],
      );
      const cgImage = send(
        image,
        "CGImageForProposedRect:context:hints:",
        [DataType.BigInt, DataType.BigInt, DataType.BigInt],
        [0n, 0n, 0n],
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
      result.addRepresentation({ scaleFactor, buffer });
    } finally {
      if (bitmap !== 0n) sendVoid(bitmap, "release");
      sendVoid(image, "release");
    }
  }
  return result;
}
