import { writeZip } from '../audit/documents/zip.js';

export interface ZipEntry {
  path: string;
  content: string;
}

/** A ZIP of text files, written by the one ZIP writer (`writeZip`): sorted names, safe paths, same bytes for the same files. */
export function zipFiles(files: ZipEntry[]): Buffer {
  return writeZip(files.map((f) => ({ name: f.path, data: f.content })));
}
