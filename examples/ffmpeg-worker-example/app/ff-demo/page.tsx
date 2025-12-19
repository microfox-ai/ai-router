import Link from 'next/link';
import { FFDemoClient } from './FFDemoClient';
import { Button } from '@/components/ui/button';

export default function FFDemoPage() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-background to-muted/20">
      <div className="container mx-auto max-w-4xl px-4 pt-8">
        <div className="flex items-center justify-between">
          <Button asChild variant="ghost">
            <Link href="/studio">← Back to Studio</Link>
          </Button>
        </div>
      </div>
      <FFDemoClient />
    </div>
  );
}

