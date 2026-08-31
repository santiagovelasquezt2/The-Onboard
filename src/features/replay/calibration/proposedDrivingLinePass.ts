import passSource from '../../../../data/calibration-runs/2024-montreal-q-d63-lap22-contact-pass.json?raw'
import { isDrivingLineRunPayload } from './drivingLineRunPayload.ts'
import {
  analyzeProposedDrivingLineMarks,
  createProposedDrivingLine,
  type ProposedDrivingLineMark,
} from './proposedDrivingLine.ts'
import { createProposedDrivingLineTwo } from './proposedDrivingLineVariant2.ts'

const parsedPass: unknown = JSON.parse(passSource)

if (!isDrivingLineRunPayload(parsedPass)) {
  throw new Error('The bundled proposed driving-line pass is invalid.')
}

export const PROPOSED_DRIVING_LINE_RUN = parsedPass.run
export const PROPOSED_DRIVING_LINE_MARKS =
  parsedPass.run.marks satisfies readonly ProposedDrivingLineMark[]
export const PROPOSED_DRIVING_LINE_POINTS_ONE = createProposedDrivingLine(
  PROPOSED_DRIVING_LINE_MARKS,
)
export const PROPOSED_DRIVING_LINE_POINTS_TWO = createProposedDrivingLineTwo(
  PROPOSED_DRIVING_LINE_POINTS_ONE,
)
/** @deprecated Use the numbered proposal export for new review surfaces. */
export const PROPOSED_DRIVING_LINE_POINTS = PROPOSED_DRIVING_LINE_POINTS_ONE
export const PROPOSED_DRIVING_LINE_ANALYSIS =
  analyzeProposedDrivingLineMarks(PROPOSED_DRIVING_LINE_MARKS)
