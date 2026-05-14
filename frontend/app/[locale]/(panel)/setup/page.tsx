import { redirect } from 'next/navigation';

export default function SetupIndexPage({ params }: { params: { locale: string } }) {
  redirect(`/${params.locale}/setup/banks`);
}
