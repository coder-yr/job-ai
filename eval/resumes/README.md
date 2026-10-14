# Resume Evaluation Golden Set (`eval/resumes`)

This directory holds the golden evaluation dataset used to benchmark local Ollama models with `npm run eval:parse` (Blueprint Chapters 9.7 & 13.4).

## File Structure

For every evaluation resume, add a matched pair of files with the same basename:

1. `<name>.txt`: The extracted plain text of the resume.
2. `<name>.json`: Ground truth labels matching the `Golden` schema:
   ```json
   {
     "skills": ["TypeScript", "React", "PostgreSQL", "Node.js"],
     "email": "user@example.com",
     "education": 1
   }
   ```

## Quality Gates

Running `npm run eval:parse` computes:
- **Skill F1 score**: Harmonic mean of Precision and Recall on detected skills. Must be **>= 0.85**.
- **Email Accuracy**: Must be **>= 0.95**.
- **Education Count Accuracy**: Compares number of educational institutions parsed.

## How to Add Your Own Resumes

1. Copy plain text from your PDF or DOCX into a new file: `eval/resumes/my_resume_v1.txt`.
2. Create `eval/resumes/my_resume_v1.json` listing the exact skills, contact email, and education entries present.
3. Run the evaluation against your local model:
   ```powershell
   npm run eval:parse
   ```
4. Note: Private resumes in `eval/resumes/*.txt` and `eval/resumes/*.json` are ignored by git in `.gitignore`.
