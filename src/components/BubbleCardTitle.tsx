interface Props {
  number: number;
  selected: boolean;
  splitOverlap?: boolean;
}

export default function BubbleCardTitle({ number, selected, splitOverlap }: Props) {
  return (
    <strong class="bubble-card-title">
      <span class="bubble-card-kind">フキダシ</span>
      <span class="bubble-card-number">{number}</span>
      {selected && <span class="bubble-card-selected">選択中</span>}
      {splitOverlap && <em class="split-overlap-badge">分割重複</em>}
    </strong>
  );
}
