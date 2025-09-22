'use server'

import { MongoClient, ObjectId } from 'mongodb';
import { RagUpstashSdk } from '@microfox/rag-upstash';
import type { Contact } from './schema';

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017';
const DB_NAME = 'contact-extractor';
const COLLECTION_NAME = 'contacts';

let client: MongoClient | null = null;

async function getClient() {
  if (!client) {
    client = new MongoClient(MONGODB_URI);
    await client.connect();
  }
  return client;
}

function ensureEmailConsistency(contact: Contact): Contact {
  const emailsSet = new Set(contact.emails || []);
  if (contact.primaryEmail) {
    emailsSet.add(contact.primaryEmail);
  }

  const newEmails = Array.from(emailsSet);
  let newPrimaryEmail = contact.primaryEmail;

  if (newEmails.length > 0 && !newPrimaryEmail) {
    newPrimaryEmail = newEmails[0];
  }

  return {
    ...contact,
    emails: newEmails,
    primaryEmail: newPrimaryEmail,
  };
}

export async function saveContacts(contacts: Contact[]) {
  if (!process.env.MONGODB_URI) {
    console.warn('MONGO_URI not set, skipping database save.');
    return [];
  }
  if (contacts.length === 0) return [];

  const client = await getClient();
  const db = client.db(DB_NAME);
  const collection = db.collection(COLLECTION_NAME);

  try {
    const consistentContacts = contacts.map(ensureEmailConsistency);

    const operations = consistentContacts.map((contact) => {
      const { _id, ...contactData } = contact;
      return {
        updateOne: {
          filter: { _id: _id ? new ObjectId(_id) : new ObjectId() },
          update: { $set: contactData },
          upsert: true,
        },
      };
    });

    if (operations.length === 0) return [];

    const result = await collection.bulkWrite(operations);
    console.log('Contacts saved to MongoDB:', result);
    return Object.values(result.upsertedIds);
  } catch (error) {
    console.error('Error saving contacts to MongoDB:', error);
    return [];
  }
}

export async function saveContactsToRag(contacts: Contact[]) {
  if (
    !process.env.UPSTASH_VECTOR_REST_URL ||
    !process.env.UPSTASH_VECTOR_REST_TOKEN
  ) {
    console.warn('Upstash credentials not set, skipping RAG save.');
    return;
  }
  if (contacts.length === 0) return;

  try {
    const rag = new RagUpstashSdk({
      upstashUrl: process.env.UPSTASH_VECTOR_REST_URL,
      upstashToken: process.env.UPSTASH_VECTOR_REST_TOKEN,
    });
    
    const consistentContacts = contacts.map(ensureEmailConsistency);

    const ragData = consistentContacts.map((contact) => {
      const doc = `Source: ${
        contact.source
      }\nName: ${contact.name || 'N/A'}\nEmails: ${
        contact.emails?.join(', ') || 'N/A'
      }\nSocials: ${JSON.stringify(contact.socials) || 'N/A'}`;
      return {
        id: (contact as any)._id?.toString() || new ObjectId().toString(),
        doc,
        metadata: contact,
      };
    });

    await rag.feedDocsToRAG(ragData);

    console.log(`${ragData.length} contacts saved to RAG.`);
  } catch (error) {
    console.error('Error saving contacts to RAG:', error);
  }
}

export async function getContacts() {
  if (!process.env.MONGODB_URI) {
    console.warn('MONGO_URI not set, skipping database fetch.');
    return [];
  }

  const client = await getClient();
  const db = client.db(DB_NAME);
  const collection = db.collection(COLLECTION_NAME);

  try {
    const contacts = await collection.find({}).toArray();
    return contacts.map(contact => ({...contact, _id: contact._id.toString()}));
  } catch (error) {
    console.error('Error fetching contacts from MongoDB:', error);
    return [];
  }
}

export async function searchContacts(query: string, topK: number = 10) {
  if (
    !process.env.UPSTASH_VECTOR_REST_URL ||
    !process.env.UPSTASH_VECTOR_REST_TOKEN
  ) {
    console.warn('Upstash credentials not set, skipping RAG search.');
    return [];
  }

  try {
    const rag = new RagUpstashSdk({
      upstashUrl: process.env.UPSTASH_VECTOR_REST_URL,
      upstashToken: process.env.UPSTASH_VECTOR_REST_TOKEN,
    });
    
    const results = await rag.query({
        data: query,
        topK: topK,
        includeMetadata: true,
    });

    return results.map((result: any) => ({...result.metadata, score: result.score}));

  } catch (error) {
    console.error('Error searching contacts from RAG:', error);
    return [];
  }
}

export async function getContactById(contactId: string): Promise<Contact | null> {
  const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017';
  const DB_NAME = 'contact-extractor';
  const COLLECTION_NAME = 'contacts';

  if (!process.env.MONGODB_URI) {
      console.warn('MONGO_URI not set, skipping database fetch.');
      return null;
  }
  
  let client: MongoClient | null = null;
  try {
      client = new MongoClient(MONGODB_URI);
      await client.connect();
      const db = client.db(DB_NAME);
      const collection = db.collection(COLLECTION_NAME);
      const contact = await collection.findOne({ _id: new ObjectId(contactId) });
      
      if (contact) {
          return { ...contact, _id: contact._id.toString() } as unknown as Contact;
      }
      return null;
  } catch (error) {
      console.error('Error fetching contact by ID:', error);
      return null;
  } finally {
      if (client) {
          await client.close();
      }
  }
}