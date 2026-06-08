import { BlobServiceClient, type AppendBlobClient } from "@azure/storage-blob";

let _service: BlobServiceClient | null = null;
const _blobCache = new Map<string, AppendBlobClient>();

function getService(): BlobServiceClient | null {
  if (_service) return _service;
  const conn = process.env.BLOB_CONNECTION_STRING;
  if (!conn) return null;
  _service = BlobServiceClient.fromConnectionString(conn);
  return _service;
}

function dayStamp(d = new Date()): string {
  return d.toISOString().slice(0, 10);
}

async function getAppendBlob(container: string): Promise<AppendBlobClient | null> {
  const svc = getService();
  if (!svc) return null;
  const name = `${dayStamp()}.jsonl`;
  const cacheKey = `${container}/${name}`;
  let client = _blobCache.get(cacheKey);
  if (client) return client;

  const containerClient = svc.getContainerClient(container);
  client = containerClient.getAppendBlobClient(name);
  await client.createIfNotExists();
  _blobCache.set(cacheKey, client);
  return client;
}

export async function appendBlobLine(container: string, line: string): Promise<boolean> {
  try {
    const client = await getAppendBlob(container);
    if (!client) return false;
    const body = line.endsWith("\n") ? line : line + "\n";
    await client.appendBlock(body, Buffer.byteLength(body));
    return true;
  } catch (err) {
    console.error(`[blob_log] append to ${container} failed:`, err);
    return false;
  }
}

export function blobLoggingEnabled(): boolean {
  return Boolean(process.env.BLOB_CONNECTION_STRING);
}

export function _resetBlobCache(): void {
  _blobCache.clear();
  _service = null;
}
