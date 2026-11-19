import { setCustomExtension } from "@pierre/diffs/utils/getFiletypeFromFileName";

for (const extension of ["asm", "ASM", "s", "S", "nasm", "NASM"]) {
  setCustomExtension(extension, "asm");
}
