'use client';

import { Contact } from '@/app/ai/agents/contactExtractorAgent/helpers/schema';
import { columns } from './columns';
import { DataTable } from './DataTable';
import { useState } from 'react';
import { PersonaModal } from '@/components/contacts-dashboard/persona-modal';

export function ContactsView({ contacts }: { contacts: Contact[] }) {
  const [selectedContact, setSelectedContact] = useState<Contact | null>(null);
  const [isPersonaModalOpen, setIsPersonaModalOpen] = useState(false);

  const openPersonaModal = (contact: Contact) => {
    setSelectedContact(contact);
    setIsPersonaModalOpen(true);
  }

  return (
    <div>
      <DataTable columns={columns(openPersonaModal)} data={contacts} />
       <PersonaModal 
            contact={selectedContact}
            isOpen={isPersonaModalOpen}
            onClose={() => setIsPersonaModalOpen(false)}
        />
    </div>
  );
}
