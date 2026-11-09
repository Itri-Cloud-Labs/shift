import { BlobStore } from '../../src/artifacts/store.js';

// Fault fixture: ingests the same file over and over until the parent SIGKILLs it at an arbitrary
// moment. Arguments: blob root, container, directory, file name.
const [root, container, directory, name] = process.argv.slice(2) as [
  string,
  string,
  string,
  string,
];
const store = new BlobStore(root);
process.stdout.write('ingesting\n');
for (;;) await store.ingest(container, directory, name, 64 * 1024 * 1024);
