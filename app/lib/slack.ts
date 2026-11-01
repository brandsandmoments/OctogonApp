import { comenziMagazine, magazine } from './magazine';
import { alerte, produseMagazine } from './produse';

/**
 * Rezumatul de dimineață pe Slack: pe fiecare magazin, comenzile de trimis, de sunat
 * și fără stoc, apoi alertele (ce se termină, ce e în trend, ce nu se mișcă), cu
 * primele câteva din fiecare și legătura spre aplicație. Merge printr-un Incoming
 * Webhook al canalului (SLACK_WEBHOOK_URL); fără el, nu pleacă nimic.
 */
export async function trimiteRezumatSlack(): Promise<string> {
  const url = process.env.SLACK_WEBHOOK_URL;
  if (!url) return 'SLACK_WEBHOOK_URL lipsește din .env: nimic trimis.';
  const app = process.env.APP_URL ?? '';
  const [lista, comenzi, produse] = await Promise.all([magazine(), comenziMagazine(), produseMagazine()]);
  const blocuri: unknown[] = [
    { type: 'header', text: { type: 'plain_text', text: `OctogonApp · ${new Date().toLocaleDateString('ro-RO', { timeZone: 'Europe/Bucharest', weekday: 'long', day: 'numeric', month: 'long' })}` } },
  ];
  const primele = (xs: string[], n = 5) => (xs.length ? xs.slice(0, n).map((x) => `• ${x}`).join('\n') + (xs.length > n ? `\n_și încă ${xs.length - n}_` : '') : '_nimic_');
  for (const m of lista.filter((x) => x.legat)) {
    const c = comenzi.filter((x) => x.magazin_id === m.id);
    const n = (s: string) => c.filter((x) => x.situatie === s).length;
    const a = alerte(produse.filter((p) => p.magazin_id === m.id));
    blocuri.push(
      { type: 'divider' },
      { type: 'section', text: { type: 'mrkdwn', text:
        `*${m.brand}* — ${n('livrabila')} de trimis · ${n('de_sunat')} de sunat · ${n('fara_stoc')} fără stoc` +
        `${c.some((x) => x.zile >= 4) ? ` · :warning: ${c.filter((x) => x.zile >= 4).length} așteaptă de 4+ zile` : ''}` } },
      { type: 'section', fields: [
        { type: 'mrkdwn', text: `*:red_circle: Clienți care așteaptă (${a.asteapta.length})*\n${primele(a.asteapta.map(({ p, m: x }) => `${p.produs} ${x.marime}: lipsă ${x.lipsa} (${x.comenzi} com.)`))}` },
        { type: 'mrkdwn', text: `*:no_entry: Terminate, se vindeau (${a.terminat.length})*\n${primele(a.terminat.map(({ p, m: x }) => `${p.produs} ${x.marime}: ${x.v30} în 30 z${x.se_poate_comanda ? '' : ', nu se mai poate comanda'}`))}` },
        { type: 'mrkdwn', text: `*:hourglass_flowing_sand: Se termină curând (${a.curand.length})*\n${primele(a.curand.map(({ p, m: x }) => `${p.produs} ${x.marime}: ${x.zile} zile`))}` },
        { type: 'mrkdwn', text: `*:chart_with_upwards_trend: În trend (${a.trend.length})*\n${primele(a.trend.map((p) => `${p.produs}: ${p.v7} buc în 7 zile`))}` },
      ] },
      { type: 'section', text: { type: 'mrkdwn', text: `*:zzz: Nu se mișcă (${a.stoc_mort.length})*\n${primele(a.stoc_mort.map((p) => `${p.produs}: ${p.stoc} buc`), 3)}` } },
    );
  }
  if (app) blocuri.push({ type: 'context', elements: [{ type: 'mrkdwn', text: `<${app}/magazine/alerte|Alertele în aplicație> · <${app}/magazine|Comenzile din magazine>` }] });
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: 'Rezumatul OctogonApp', blocks: blocuri }) });
  return r.ok ? 'trimis' : `Slack a refuzat (${r.status}): ${await r.text()}`;
}
