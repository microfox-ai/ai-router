import Head from 'next/head';
import { AppLayout } from '@/components/studio/layout/StudioLayout';

export default function StudioLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  //   const sessionId = Array.isArray(slug) && slug.length > 1 ? slug[1] : undefined;
  if (process.env.NODE_ENV != 'development') {
    return <div>Not allowed</div>;
  }
  return (
    <>
      <Head>
        <link
          href="https://fonts.googleapis.com/icon?family=Material+Icons&display=block"
          rel="stylesheet"
        ></link>
        <link
          href="https://fonts.googleapis.com/icon?family=Material+Icons+Outlined&display=block"
          rel="stylesheet"
        ></link>
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@24,100..700,0,0&display=block"
        ></link>
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap"
        />
      </Head>
      <AppLayout>{children}</AppLayout>
    </>
  );
}
