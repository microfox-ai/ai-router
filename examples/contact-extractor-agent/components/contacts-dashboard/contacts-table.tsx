'use client';

import { useEffect, useState, useRef } from 'react';
import { Contact } from '@/app/ai/agents/contactExtractorAgent/helpers/schema';
import { DataTable } from './data-table';
import { columns } from './columns';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { PersonaModal } from './persona-modal';

interface SearchResult {
    metadata: Contact;
    score: number;
}

async function getContacts(): Promise<Contact[]> {
    console.log(`Fetching all contacts...`);
    const url = '/api/contacts';
    try {
        const response = await fetch(url);
        if (!response.ok) {
            console.error(`API request to ${url} failed with status ${response.status}`);
            return [];
        }
        const data = await response.json();
        console.log(`Successfully fetched ${data.length} contacts from ${url}`);
        return data;
    } catch (error) {
        console.error(`An error occurred while fetching from ${url}:`, error);
        return [];
    }
}

async function searchContacts(query: string, topK: number): Promise<SearchResult[]> {
    console.log(`Searching contacts... Query: "${query}", topK: ${topK}`);
    const url = `/api/contacts?q=${query}&topK=${topK}`;
    try {
        const response = await fetch(url);
        if (!response.ok) {
            console.error(`API request to ${url} failed with status ${response.status}`);
            return [];
        }
        const data = await response.json();
        console.log(`Successfully fetched ${data.length} contacts from ${url}`);
        return data;
    } catch (error) {
        console.error(`An error occurred while fetching from ${url}:`, error);
        return [];
    }
}

export function ContactsTable() {
    const [contacts, setContacts] = useState<Contact[] | SearchResult[]>([]);
    const [search, setSearch] = useState('');
    const [topK, setTopK] = useState(10);
    const [selectedContact, setSelectedContact] = useState<Contact | null>(null);
    const [isPersonaModalOpen, setIsPersonaModalOpen] = useState(false);

    const openPersonaModal = (contact: Contact) => {
        setSelectedContact(contact);
        setIsPersonaModalOpen(true);
    }
    
    const refreshData = () => {
        if (search) {
            handleSearch();
        } else {
            getContacts().then(setContacts);
        }
    }

    const handleSearch = async () => {
        if (!search) {
            getContacts().then(setContacts);
            return;
        }
        const results = await searchContacts(search, topK);
        setContacts(results);
    }

    // Effect for the initial data load when the component mounts.
    useEffect(() => {
        console.log('Component mounted. Fetching initial contacts.');
        getContacts().then(setContacts);
    }, []); // Empty dependency array ensures this runs only once on mount.

    const tableData = contacts.map(c => 'metadata' in c ? { ...c.metadata, score: c.score } : c);

    return (
        <div className="w-full">
            <div className="flex items-center space-x-2 py-4">
                <Input
                    placeholder="Search contacts..."
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    className="max-w-sm"
                />
                <Input
                    type="number"
                    placeholder="topK"
                    value={topK}
                    onChange={(event) => setTopK(parseInt(event.target.value, 10))}
                    className="max-w-[100px]"
                />
                <Button onClick={handleSearch}>Search</Button>
            </div>
            <DataTable columns={columns(openPersonaModal, refreshData)} data={tableData} />
            <PersonaModal 
                contact={selectedContact}
                isOpen={isPersonaModalOpen}
                onClose={() => setIsPersonaModalOpen(false)}
            />
        </div>
    );
}
