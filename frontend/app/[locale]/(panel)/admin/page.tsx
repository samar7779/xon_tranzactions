import { redirect } from 'next/navigation';

export default function AdminIndexPage({ params }: { params: { locale: string } }) {
  redirect(`/${params.locale}/admin/users`);
}
