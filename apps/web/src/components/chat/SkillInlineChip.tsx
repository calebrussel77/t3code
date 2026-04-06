import { WandSparklesIcon } from "lucide-react";

import {
  COMPOSER_INLINE_CHIP_CLASS_NAME,
  COMPOSER_INLINE_CHIP_ICON_CLASS_NAME,
  COMPOSER_INLINE_CHIP_LABEL_CLASS_NAME,
} from "../composerInlineChip";

export function SkillInlineChip({ name }: { name: string }) {
  return (
    <span className={COMPOSER_INLINE_CHIP_CLASS_NAME}>
      <WandSparklesIcon className={`${COMPOSER_INLINE_CHIP_ICON_CLASS_NAME} text-purple-500`} />
      <span className={COMPOSER_INLINE_CHIP_LABEL_CLASS_NAME}>{name}</span>
    </span>
  );
}
