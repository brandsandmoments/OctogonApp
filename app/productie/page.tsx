import Plan from './Plan';

export const dynamic = 'force-dynamic';

/** Producție · planul pe săptămâni (fără mostre: ele au fila lor, /productie/mostre). */
export default function PlanPeSaptamani({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  return <Plan searchParams={searchParams} />;
}
