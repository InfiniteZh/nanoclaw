export interface ExtractedToolStep {
  stepType: 'tool_call' | 'tool_result' | 'assistant_text';
  content: string;
}

export function extractToolStepsFromSdkMessage(
  message: unknown,
): ExtractedToolStep[] {
  if (!message || typeof message !== 'object') {
    return [];
  }

  const record = message as {
    type?: string;
    message?: { content?: unknown };
  };
  const content = Array.isArray(record.message?.content)
    ? record.message.content
    : [];

  if (record.type === 'assistant') {
    return content.flatMap((item): ExtractedToolStep[] => {
      if (!item || typeof item !== 'object') {
        return [];
      }

      const typedItem = item as {
        type?: string;
        text?: string;
        name?: string;
        input?: unknown;
      };

      if (typedItem.type === 'text') {
        const text = typeof typedItem.text === 'string' ? typedItem.text.trim() : '';
        return text
          ? [{
              stepType: 'assistant_text' as const,
              content: text,
            }]
          : [];
      }

      if (typedItem.type === 'tool_use') {
        return [{
          stepType: 'tool_call' as const,
          content: JSON.stringify({
            name: typedItem.name || 'unknown',
            arguments: typedItem.input ?? {},
          }),
        }];
      }

      return [];
    });
  }

  if (record.type === 'user') {
    return content
      .filter(
        (
          item,
        ): item is {
          type?: string;
          tool_use_id?: string;
          content?: unknown;
          is_error?: boolean;
        } => !!item && typeof item === 'object',
      )
      .filter((item) => item.type === 'tool_result')
      .map((item) => ({
        stepType: 'tool_result' as const,
        content: JSON.stringify({
          tool_use_id: item.tool_use_id,
          content: item.content,
          is_error: item.is_error === true,
        }),
      }));
  }

  return [];
}
