import { Type } from 'typebox';
import { EffortSchema, TargetSchema } from './results.js';

export const ReviewInputSchema = Type.Object({
  target: Type.Optional(TargetSchema),
  effort: Type.Optional(EffortSchema),
  fix: Type.Optional(Type.Boolean({ description: 'Explicitly authorized working-tree fixes only; default false.' })),
  comment: Type.Optional(Type.Boolean({ description: 'Explicitly authorized publication only; default false.' })),
  maxFindings: Type.Optional(Type.Union([Type.Integer({ minimum: 1 }), Type.Literal('all'), Type.Literal('default')])),
  context: Type.Optional(Type.String({ description: 'Supplementary guidance, not target arguments or authorization.' })),
  workingDirectory: Type.Optional(Type.String({ minLength: 1 })),
  timeoutSeconds: Type.Optional(Type.Number({ minimum: 1, maximum: 3600 })),
  cloudPost: Type.Optional(Type.Union([Type.Literal('post'), Type.Literal('no-post')], { description: 'Recognized manual-only cloud controls; rejected for execution.' })),
}, { additionalProperties: false });
