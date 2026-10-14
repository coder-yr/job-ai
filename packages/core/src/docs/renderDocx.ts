// packages/core/src/docs/renderDocx.ts  - ATS-friendly DOCX: single column, real text, no tables/images
// docx type declarations omit relative file extensions in build/index.d.ts under NodeNext
// eslint-disable-next-line @typescript-eslint/no-explicit-any
import * as docx from "docx";

const {
  Document, Packer, Paragraph, TextRun, HeadingLevel,
  AlignmentType, convertMillimetersToTwip, BorderStyle,
} = docx as any;
import { writeFile } from "node:fs/promises";
import type { TailoredResume } from "@jobpilot/shared";

export async function renderDocx(
  p: { fullName: string; email?: string | null; phone?: string | null; location?: string | null },
  t: TailoredResume,
  titles: Map<string, { heading: string; sub?: string }>,
  outPath: string,
): Promise<void> {
  const margin = convertMillimetersToTwip(18);

  const contactParts = [p.email, p.phone, p.location].filter(Boolean) as string[];

  const children: any[] = [
    // Name
    new Paragraph({
      children: [new TextRun({ text: p.fullName, bold: true, size: 36 })],
      alignment: AlignmentType.LEFT,
      spacing: { after: 80 },
    }),
    // Contact line
    ...(contactParts.length > 0
      ? [new Paragraph({
          children: [new TextRun({ text: contactParts.join("  |  "), size: 20, color: "555555" })],
          spacing: { after: 200 },
        })]
      : []),
    // Summary
    sectionHeading("Summary"),
    new Paragraph({
      children: [new TextRun({ text: t.summary, size: 20 })],
      spacing: { after: 160 },
    }),
    // Skills
    sectionHeading("Skills"),
    new Paragraph({
      children: [new TextRun({ text: t.skills.join(", "), size: 20 })],
      spacing: { after: 160 },
    }),
    // Experience & Projects
    sectionHeading("Experience & Projects"),
    ...t.sections.flatMap((sec) => {
      const h = titles.get(sec.sourceId);
      return [
        new Paragraph({
          children: [
            new TextRun({ text: h?.heading ?? sec.sourceId, bold: true, size: 22 }),
            ...(h?.sub ? [new TextRun({ text: `  ${h.sub}`, size: 20, color: "555555" })] : []),
          ],
          spacing: { before: 120, after: 40 },
        }),
        ...sec.bullets.map((b) =>
          new Paragraph({
            bullet: { level: 0 },
            children: [new TextRun({ text: b.text, size: 20 })],
            spacing: { after: 40 },
          }),
        ),
      ];
    }),
  ];

  const doc = new Document({
    sections: [{
      properties: {
        page: {
          margin: { top: margin, bottom: margin, left: margin, right: margin },
        },
      },
      children,
    }],
  });

  const buf = await Packer.toBuffer(doc);
  await writeFile(outPath, buf);
}

function sectionHeading(text: string): any {
  return new Paragraph({
    heading: HeadingLevel.HEADING_2,
    children: [new TextRun({ text, bold: true, size: 24, allCaps: true })],
    border: {
      bottom: { style: BorderStyle.SINGLE, size: 6, space: 1, color: "999999" },
    },
    spacing: { before: 200, after: 80 },
  });
}
