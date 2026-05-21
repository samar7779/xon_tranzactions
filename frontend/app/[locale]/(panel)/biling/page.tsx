import { redirect } from 'next/navigation';

export default function LegacyBilingRedirect({ params }: { params: { locale: string } }) {
  redirect(`/${params.locale}/oplatykv/billing`);
}
