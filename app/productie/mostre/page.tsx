import Plan from '../Plan';

export const dynamic = 'force-dynamic';

/** Producție · Mostre: mostrele croite, cu tot ce are o comandă din plan (dă în lucru, cine lucrează, ieșit). */
export default function MostreInProductie({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  return <Plan searchParams={searchParams} mostre />;
}
