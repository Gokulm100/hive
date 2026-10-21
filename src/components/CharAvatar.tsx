import { charHtml, type CharRef } from "../data/chars";

type Props = {
  refAgent?: CharRef | null;
  animClass?: string;
  className?: string;
};

export function CharAvatar({ refAgent, animClass = "", className }: Props) {
  const html = charHtml(refAgent, animClass);
  if (!html) return <div className={className} aria-hidden="true" />;
  return (
    <div
      className={className}
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
