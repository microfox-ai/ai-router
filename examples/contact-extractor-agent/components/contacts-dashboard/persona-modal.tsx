
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog"
import { Contact } from "@/app/ai/agents/contactExtractorAgent/helpers/schema";

interface PersonaModalProps {
    contact: Contact | null;
    isOpen: boolean;
    onClose: () => void;
}

export function PersonaModal({ contact, isOpen, onClose }: PersonaModalProps) {
    if (!contact || !contact.persona) return null;

    return (
        <Dialog open={isOpen} onOpenChange={onClose}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>{contact.name || 'Contact'} Persona</DialogTitle>
                    <DialogDescription>
                       Detailed persona analysis.
                    </DialogDescription>
                </DialogHeader>
                <div className="space-y-4">
                   <div>
                        <h3 className="font-semibold">Profession</h3>
                        <p>{contact.persona.profession || 'N/A'}</p>
                   </div>
                   <div>
                        <h3 className="font-semibold">Age</h3>
                        <p>{contact.persona.age || 'N/A'}</p>
                   </div>
                   <div>
                        <h3 className="font-semibold">Location</h3>
                        <p>{contact.persona.location || 'N/A'}</p>
                   </div>
                   <div>
                        <h3 className="font-semibold">Summary</h3>
                        <p>{contact.persona.summary || 'N/A'}</p>
                   </div>
                   <div>
                        <h3 className="font-semibold">Interests</h3>
                        <p>{contact.persona.interests?.join(', ') || 'N/A'}</p>
                   </div>
                </div>
            </DialogContent>
        </Dialog>
    )
}
