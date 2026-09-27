import { SkillDetail } from '@/components/skills/SkillDetail';

export default function SkillDetailPage({ params }: { params: { id: string } }) {
  return <SkillDetail skillId={params.id} />;
}
