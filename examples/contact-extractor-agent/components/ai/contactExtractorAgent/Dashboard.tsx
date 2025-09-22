'use client';

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { ContactsView } from './ContactsView';
import { AiRouterTools } from '@/app/ai';
import { ComponentType } from 'react';
import { ToolUIPart } from 'ai';

export const Dashboard: ComponentType<{
  tool: ToolUIPart<Pick<AiRouterTools, 'contactExtractor'>>;
}> = (props) => {
  const { tool } = props;
  const { contacts = [], pagesScraped = 0, usage = { totalTokens: 0 } } = tool.output || {};

  return (
    <div className="hidden flex-col md:flex">
      <div className="flex-1 space-y-4 p-8 pt-6">
        <div className="flex items-center justify-between space-y-2">
          <h2 className="text-3xl font-bold tracking-tight">Contact Extraction Results</h2>
        </div>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">
                Total Contacts Found
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{contacts.length}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">
                Pages Scraped
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{pagesScraped}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">
                Total AI Usage
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{usage.totalTokens} tokens</div>
            </CardContent>
          </Card>
        </div>
        <div className="grid gap-4">
          <Card className="col-span-4">
            <CardHeader>
              <CardTitle>Contacts</CardTitle>
              <CardDescription>
                A list of all contacts found during the extraction process.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ContactsView contacts={contacts} />
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
