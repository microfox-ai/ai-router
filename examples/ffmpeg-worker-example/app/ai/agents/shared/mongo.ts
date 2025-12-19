'use server';

import { MongoClient, type Db } from 'mongodb';

declare global {
  // eslint-disable-next-line no-var
  var __aiRouterMongoClientPromise: Promise<MongoClient> | undefined;
}

function getMongoUri(): string {
  const uri = process.env.DATABASE_MONGODB_URI || process.env.MONGODB_URI;
  if (!uri) {
    throw new Error(
      'Missing MongoDB connection string. Set DATABASE_MONGODB_URI (recommended) or MONGODB_URI.'
    );
  }
  return uri;
}

function getMongoDbName(): string {
  return process.env.DATABASE_MONGODB_DB || process.env.MONGODB_DB || 'ai_router';
}

async function getMongoClient(): Promise<MongoClient> {
  const uri = getMongoUri();

  // Reuse a single client across hot reloads / lambda invocations when possible.
  if (!globalThis.__aiRouterMongoClientPromise) {
    const client = new MongoClient(uri, {
      // Keep defaults conservative; works on both local dev and Lambda.
      maxPoolSize: 10,
      minPoolSize: 0,
      serverSelectionTimeoutMS: 10_000,
    });
    globalThis.__aiRouterMongoClientPromise = client.connect();
  }

  return globalThis.__aiRouterMongoClientPromise;
}

export async function getMongoDb(): Promise<Db> {
  const client = await getMongoClient();
  return client.db(getMongoDbName());
}

