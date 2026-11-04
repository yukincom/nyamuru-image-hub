import type {Figure} from '../types.ts';
import {isPropPlacement} from './catalogModel.ts';
import {isDetectedFigureCharacter} from './systemCharacters.ts';

/** The native canvas and paint preview show the same assignment/review status. */
export function figureCanvasClass(figure:Figure):string {
  if(isPropPlacement(figure))return 'is-object';
  if(figure.analogImport?.analysisReview)return 'is-analysis-review';
  return !figure.refId||isDetectedFigureCharacter(figure)?'is-unassigned':'is-confirmed-person';
}
