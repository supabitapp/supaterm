// @effect-diagnostics nodeBuiltinImport:off - This standalone release helper writes one file.
import * as NodeFS from "node:fs";
import { PNG } from "pngjs";
import { QrCode } from "@supaterm/shared/qrCode";

const MODULE_PIXELS = 16;
const QUIET_ZONE_MODULES = 4;

export function reviewQrPng(value: string) {
  const qr = QrCode.encodeText(value, QrCode.Ecc.MEDIUM);
  const modules = qr.size + QUIET_ZONE_MODULES * 2;
  const size = modules * MODULE_PIXELS;
  const png = new PNG({ width: size, height: size, colorType: 0, inputColorType: 0, bitDepth: 8 });
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const moduleX = Math.floor(x / MODULE_PIXELS) - QUIET_ZONE_MODULES;
      const moduleY = Math.floor(y / MODULE_PIXELS) - QUIET_ZONE_MODULES;
      const dark =
        moduleX >= 0 &&
        moduleY >= 0 &&
        moduleX < qr.size &&
        moduleY < qr.size &&
        qr.getModule(moduleX, moduleY);
      const offset = (y * size + x) * 4;
      const shade = dark ? 0 : 255;
      png.data[offset] = shade;
      png.data[offset + 1] = shade;
      png.data[offset + 2] = shade;
      png.data[offset + 3] = 255;
    }
  }
  return PNG.sync.write(png, { colorType: 0 });
}

if (import.meta.main) {
  const [value, output] = process.argv.slice(2);
  if (!value || !output) throw new Error("Usage: qr-image.ts <pairing-url> <output.png>");
  NodeFS.writeFileSync(output, reviewQrPng(value));
}
