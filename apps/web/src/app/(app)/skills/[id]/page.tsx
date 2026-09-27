import { SkillDetail } from '@/components/skills/SkillDetail';

export default async function SkillDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <SkillDetail skillId={id} />;
}
