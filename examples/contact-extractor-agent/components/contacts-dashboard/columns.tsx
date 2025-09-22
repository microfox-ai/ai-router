"use client"

import { ColumnDef } from "@tanstack/react-table"
import { Contact } from "@/app/ai/agents/contactExtractorAgent/helpers/schema"
import { Button } from "@/components/ui/button"
import { useState } from "react"
import { Github, Linkedin, Twitter, Home, UserSquare } from "lucide-react"
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from "@/components/ui/tooltip"

async function analyzePersona(contactId: string, urls: string[]): Promise<Contact> {
    // This will be a call to our agent.
    const response = await fetch(`/api/studio/chat/agent/extract/deep-persona?contactId=${contactId}&urls=${urls.join(',')}`);
    if (!response.ok) {
        throw new Error('Failed to analyze persona');
    }
    const result = await response.json();

    if (result?.error) {
        throw new Error(result.error);
    }

    return result[0]?.parts[0]?.output?.contact;
}


export const columns = (
    openPersonaModal: (contact: Contact) => void,
    refreshData: () => void
): ColumnDef<Contact & { score?: number }>[] => [
  {
    accessorKey: "name",
    header: "Name",
    cell: ({ row }) => row.original.name || "N/A",
  },
  {
    accessorKey: "primaryEmail",
    header: "Email",
    cell: ({ row }) => {
        const email = row.original.primaryEmail;
        if (!email) return "N/A";
        return (
            <TooltipProvider>
                <Tooltip>
                    <TooltipTrigger asChild>
                        <span className="truncate max-w-[200px] block">{email}</span>
                    </TooltipTrigger>
                    <TooltipContent>
                        <p>{email}</p>
                    </TooltipContent>
                </Tooltip>
            </TooltipProvider>
        )
    }
  },
  {
    header: "Socials",
    cell: ({ row }) => {
        const { socials } = row.original;
        return (
            <div className="flex space-x-2">
                {socials?.linkedin && <TooltipProvider><Tooltip><TooltipTrigger asChild><a href={socials.linkedin} target="_blank" rel="noreferrer"><Linkedin className="h-5 w-5 text-blue-500" /></a></TooltipTrigger><TooltipContent><p>{socials.linkedin}</p></TooltipContent></Tooltip></TooltipProvider>}
                {socials?.github && <TooltipProvider><Tooltip><TooltipTrigger asChild><a href={socials.github} target="_blank" rel="noreferrer"><Github className="h-5 w-5" /></a></TooltipTrigger><TooltipContent><p>{socials.github}</p></TooltipContent></Tooltip></TooltipProvider>}
                {socials?.twitter && <TooltipProvider><Tooltip><TooltipTrigger asChild><a href={socials.twitter} target="_blank" rel="noreferrer"><Twitter className="h-5 w-5 text-blue-400" /></a></TooltipTrigger><TooltipContent><p>{socials.twitter}</p></TooltipContent></Tooltip></TooltipProvider>}
            </div>
        )
    }
  },
  {
    accessorKey: "socials.portfolio",
    header: "Portfolio",
    cell: ({ row }) => {
        const portfolio = row.original.socials?.portfolio
        return portfolio ? (
             <TooltipProvider>
                <Tooltip>
                    <TooltipTrigger asChild>
                        <a href={portfolio} target="_blank" rel="noreferrer"><Home className="h-5 w-5 text-gray-500" /></a>
                    </TooltipTrigger>
                    <TooltipContent>
                        <p>{portfolio}</p>
                    </TooltipContent>
                </Tooltip>
            </TooltipProvider>
        ) : "N/A"
    }
  },
   {
    accessorKey: "score",
    header: "Score",
    cell: ({ row }) => {
        const score = row.original.score;
        return score ? score.toFixed(4) : "N/A";
    }
  },
  {
    id: "actions",
    cell: ({ row }) => {
      const contact = row.original;
      const [isLoading, setIsLoading] = useState(false);

      const handleAnalyze = async () => {
          if (!contact._id) return;
          const urls = Object.values(contact.socials || {}).filter(Boolean) as string[];
        //   if(contact.source) urls.push(contact.source);
          if (urls.length === 0) {
              alert("No URLs found for this contact to analyze.");
              return;
          }
          setIsLoading(true);
          try {
              const updatedContact = await analyzePersona(contact._id, urls);
              alert('Persona analysis complete!');
              refreshData();
              openPersonaModal(updatedContact);
          } catch (error) {
              console.error(error);
              alert('Failed to analyze persona.');
          } finally {
              setIsLoading(false);
          }
      }
 
      return (
        <div className="flex space-x-2">
            {contact.persona && (
                 <Button variant="ghost" className="h-8 w-8 p-0" onClick={() => openPersonaModal(contact)}>
                    <UserSquare className="h-5 w-5" />
                </Button>
            )}
            <Button variant="outline" size="sm" onClick={handleAnalyze} disabled={isLoading}>
                {isLoading ? "Analyzing..." : "Deeper Analysis"}
            </Button>
        </div>
      )
    },
  },
]
