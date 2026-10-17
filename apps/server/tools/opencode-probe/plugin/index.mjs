// OpenCode v2 plugin used only by the capability probe. It registers one direct (non-code-mode)
// tool and forwards every call to a Shift-owned validator. Shift, not this plugin, decides validity.
export default {
  id: 'shift-probe',
  async setup(ctx) {
    const callback = ctx.options?.callback;
    await ctx.tool.transform((editor) => {
      editor.namespace({ name: 'shift', description: 'Shift workflow integration' });
      editor.add({
        name: 'submit_result',
        description:
          'Submit the terminal result of the current Shift task. Call it once when the task is completed, blocked or failed.',
        input: {
          type: 'object',
          properties: {
            status: { type: 'string', enum: ['completed', 'blocked', 'failed'] },
            data: { type: 'object' },
            blocker: {
              type: 'object',
              properties: { code: { type: 'string' }, message: { type: 'string' } },
              required: ['code', 'message'],
            },
            error: {
              type: 'object',
              properties: { code: { type: 'string' }, message: { type: 'string' } },
              required: ['code', 'message'],
            },
          },
          required: ['status'],
          additionalProperties: false,
        },
        options: { namespace: 'shift', codemode: false },
        execute: async (input, context) => {
          const response = await fetch(callback, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              sessionID: context.sessionID,
              messageID: context.messageID,
              callID: context.id,
              agent: context.agent,
              input,
            }),
            signal: context.signal,
          });
          const verdict = await response.json();
          if (!verdict.accepted) {
            throw new Error(
              `Shift rejected the result: ${verdict.reason}. Correct it and call again.`,
            );
          }
          return { content: 'Shift accepted the result. End your turn now.' };
        },
      });
    });
  },
};
