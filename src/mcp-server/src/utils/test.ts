import { getTableFromSection, serializeTableToString, replaceTableInSection } from './manifest.js';

const md = `
# Title
## Agents
| Role | Name | Status |
| --- | --- | --- |
| PM | Alice | Active |
| Dev | Bob | Pending |

## Other
Some text
`;

const res = getTableFromSection(md, "Agents");
console.log("Parsed:", res);

if (res) {
    res.rows[1].Status = "Active";
    const newTable = serializeTableToString(res.headers, res.rows);
    console.log("New table:\n" + newTable);

    const newMd = replaceTableInSection(md, "Agents", newTable);
    console.log("New MD:\n" + newMd);
}
