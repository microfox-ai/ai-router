import React from 'react';
import { ContactsTable } from '@/components/contacts-dashboard/contacts-table';

const page = () => {
  return (
    <div
      className={`flex h-screen flex-col items-center overflow-hidden justify-start w-[80vw] p-5
`}
    >
      <div className="flex flex-col items-center justify-start space-y-2 w-full h-full">
        <h2 className="text-3xl font-bold tracking-tight w-full text-left">Contacts</h2>
        <ContactsTable />
      </div>
    </div>
  );
};

export default page;
