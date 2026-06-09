"use client";

import Image from 'next/image';
import type { DetectionBox } from '@/lib/types';

interface ImageWithBoxesProps {
  imageUrl: string;
  boxes: DetectionBox[];
}

const stageColors: Record<string, string> = {
  flower: "border-pink-400",
  fruitlet: "border-yellow-300",
  immature: "border-green-400",
  breaker: "border-lime-400",
  ripening: "border-amber-400",
  pink: "border-rose-400",
  mature: "border-red-500",
  overripened: "border-purple-500",
  default: "border-slate-300",
};

export function ImageWithBoxes({ imageUrl, boxes }: ImageWithBoxesProps) {
  return (
    <div className="relative w-full aspect-video overflow-hidden rounded-lg border">
      <Image
        src={imageUrl}
        alt="Tomato plant analysis"
        fill
        className="object-cover"
        sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
        priority
      />
      {boxes.map((item, index) => {
        const [x1, y1, x2, y2] = item.box;
        return (
          <div
            key={index}
            className={`absolute border-2 ${stageColors[item.stage] || stageColors.default}`}
            style={{
              left: `${x1 * 100}%`,
              top: `${y1 * 100}%`,
              width: `${(x2 - x1) * 100}%`,
              height: `${(y2 - y1) * 100}%`,
            }}
          ></div>
        );
      })}
    </div>
  );
}
