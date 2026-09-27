import { SectionHeader, Button } from '@careeros/ui';
import { SearchProvidersPanel } from '@/components/search-providers/SearchProvidersPanel';

export default function SearchProvidersPage() {
  return (
    <main className="mx-auto flex w-full max-w-[1200px] flex-col gap-8 px-12 py-14">
      <SectionHeader
        eyebrow="Settings"
        title="Search providers"
        description="News and search backends that power market refresh, company dossiers, and technology signals. Quota bars double as status."
        trailing={<Button>Add provider</Button>}
      />
      <SearchProvidersPanel />
    </main>
  );
}
