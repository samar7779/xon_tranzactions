import { redirect } from 'next/navigation';

export default function OplatyKvIndex({ params }: { params: { locale: string } }) {
  redirect(`/${params.locale}/oplatykv/crm`);
}
