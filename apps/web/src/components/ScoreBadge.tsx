// apps/web/src/components/ScoreBadge.tsx  - colour is never the only signal (accessible)
export function ScoreBadge({ score }: { score: number }) {
  const tier = score >= 75 ? "Strong" : score >= 55 ? "Fair" : "Weak";
  const colour = score >= 75 ? "bg-emerald-600" : score >= 55 ? "bg-amber-600" : "bg-gray-500";
  return (
    <span className={`inline-block min-w-10 rounded px-2 py-1 text-center font-bold text-white ${colour}`}
          role="img" aria-label={`Match score ${score} out of 100, ${tier} match`} title={`${tier} match`}>
      {score}
    </span>
  );
}
