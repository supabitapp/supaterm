import { loadExpoFileSystem } from "./expoFileSystem";
import type { File } from "expo-file-system";

let tempFileSequence = 0;

export async function writeFileAtomically(file: File, contents: string): Promise<void> {
  const { File: FileConstructor } = await loadExpoFileSystem();
  tempFileSequence += 1;
  const temp = new FileConstructor(file.parentDirectory, `${file.name}.${tempFileSequence}.tmp`);
  try {
    temp.create({ intermediates: true, overwrite: true });
    await temp.write(contents);
    temp.moveSync(file, { overwrite: true });
  } catch (error) {
    try {
      if (temp.exists) temp.delete();
    } catch {}
    throw error;
  }
}
