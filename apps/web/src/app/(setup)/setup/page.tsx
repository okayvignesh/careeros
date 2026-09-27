import { redirect } from 'next/navigation';

export default function SetupIndex() {
  redirect('/setup/01-preflight');
}
