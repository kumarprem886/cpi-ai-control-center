import fs from 'fs';
import path from 'path';
import fse from 'fs-extra';
import { fileURLToPath } from 'url';
import { ZipArchive } from 'archiver';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const GENERATED_DIR = path.join(__dirname, 'generated');
const MAPPING_TEMPLATE_DIR = path.join(__dirname, 'mapping-template', 'base', 'mapping');

function resolveTemplateMmapFile() {
  console.log('[MAPPING] Looking for template folder:', MAPPING_TEMPLATE_DIR);

  if (!fs.existsSync(MAPPING_TEMPLATE_DIR)) {
    throw new Error(`Mapping template folder not found: ${MAPPING_TEMPLATE_DIR}`);
  }

  const files = fs.readdirSync(MAPPING_TEMPLATE_DIR)
    .filter((f) => f.toLowerCase().endsWith('.mmap'));

  console.log('[MAPPING] Found .mmap files:', files);

  if (files.length === 0) {
    throw new Error(`No .mmap template file found in: ${MAPPING_TEMPLATE_DIR}`);
  }

  return path.join(MAPPING_TEMPLATE_DIR, files[0]);
}

export async function buildMappingZip(mappingName, rows) {
  const safeName = sanitizeName(mappingName || 'Generated_Mapping');

  await fse.ensureDir(GENERATED_DIR);

  const tempDir = path.join(GENERATED_DIR, `tmp_mapping_${Date.now()}`);
  const mappingDir = path.join(tempDir, 'mapping');
  const xsdDir = path.join(tempDir, 'xsd');

  await fse.ensureDir(mappingDir);
  await fse.ensureDir(xsdDir);

  const templateFile = resolveTemplateMmapFile();
  console.log('[MAPPING] Using template file:', templateFile);

  const sourceXsdName = 'Source.xsd';
  const targetXsdName = 'Target.xsd';
  const rootName = 'root';

  const sourceXsd = buildSourceXsd(rows, rootName);
  const targetXsd = buildTargetXsd(rows, rootName);
  const mmap = buildMmapFromTemplate(
    templateFile,
    safeName,
    rows,
    sourceXsdName,
    targetXsdName,
    rootName,
    rootName
  );

  fs.writeFileSync(path.join(mappingDir, `${safeName}.mmap`), mmap, 'utf-8');
  fs.writeFileSync(path.join(xsdDir, sourceXsdName), sourceXsd, 'utf-8');
  fs.writeFileSync(path.join(xsdDir, targetXsdName), targetXsd, 'utf-8');

  const zipPath = path.join(GENERATED_DIR, `${safeName}.zip`);
  await zipFolder(tempDir, zipPath);

  await fse.remove(tempDir);

  return {
    fileName: `${safeName}.zip`,
    zipPath
  };
}

function sanitizeName(name) {
  return String(name || '')
    .trim()
    .replace(/[^\w.-]/g, '_');
}

function buildSourceXsd(rows, rootName = 'root') {
  const uniqueFields = [...new Set(
    rows
      .filter(r => r.sourceElementName)
      .map(r => r.sourceElementName)
  )];

  const fields = uniqueFields
    .map(name => `        <xs:element name="${escapeXml(name)}" type="xs:string" minOccurs="0"/>`)
    .join('\n');

  return `<?xml version="1.0" encoding="utf-8"?>
<xs:schema attributeFormDefault="unqualified" elementFormDefault="qualified" xmlns:xs="http://www.w3.org/2001/XMLSchema">
  <xs:element name="${escapeXml(rootName)}">
    <xs:complexType>
      <xs:sequence>
${fields}
      </xs:sequence>
    </xs:complexType>
  </xs:element>
</xs:schema>`;
}

function buildTargetXsd(rows, rootName = 'root') {
  const uniqueFields = [...new Set(
    rows
      .filter(r => r.targetElementName)
      .map(r => r.targetElementName)
  )];

  const fields = uniqueFields
    .map(name => `        <xs:element name="${escapeXml(name)}" type="xs:string" minOccurs="0"/>`)
    .join('\n');

  return `<?xml version="1.0" encoding="utf-8"?>
<xs:schema attributeFormDefault="unqualified" elementFormDefault="qualified" xmlns:xs="http://www.w3.org/2001/XMLSchema">
  <xs:element name="${escapeXml(rootName)}">
    <xs:complexType>
      <xs:sequence>
${fields}
      </xs:sequence>
    </xs:complexType>
  </xs:element>
</xs:schema>`;
}

function buildMmapFromTemplate(templateFile, mappingName, rows, sourceXsdName, targetXsdName, sourceRoot, targetRoot) {
  let xml = fs.readFileSync(templateFile, 'utf-8');

  xml = xml.replace(
    /(<lnkRole[^>]*role="SOURCE_IFR_MESS"[\s\S]*?<key[^>]*typeID="xsd"[^>]*>[\s\S]*?<elem>)([^<]*)(<\/elem>\s*<elem>)([^<]*)(<\/elem>\s*<elem>)([^<]*)(<\/elem>)/,
    `$1${sourceXsdName}$3src/main/resources/xsd$5${sourceRoot}$7`
  );

  xml = xml.replace(
    /(<lnkRole[^>]*role="TARGET_IFR_MESS"[\s\S]*?<key[^>]*typeID="xsd"[^>]*>[\s\S]*?<elem>)([^<]*)(<\/elem>\s*<elem>)([^<]*)(<\/elem>\s*<elem>)([^<]*)(<\/elem>)/,
    `$1${targetXsdName}$3src/main/resources/xsd$5${targetRoot}$7`
  );

  xml = xml.replace(
    /(<text label=")([^"]*)("><\/text>)/,
    `$1${escapeXml(mappingName)}$3`
  );

  xml = xml.replace(
    /<transformation>[\s\S]*?<\/transformation>/,
    `<transformation>${buildTransformation(rows, sourceRoot, targetRoot)}</transformation>`
  );

  return xml;
}

function buildTransformation(rows, sourceRoot, targetRoot) {
  const bricks = [];

  bricks.push(buildDirectBrick(`/${targetRoot}`, `/${sourceRoot}`, 200, 40, 50, 40));

  let y = 80;

  for (const row of rows) {
    if (!row.targetPath) continue;

    const type = row.transformationType || 'direct';

    if (type === 'constant') {
      // Hardcoded constant value brick
      const val = row.constantValue || row.comments?.trim() || row.transformationRule?.trim() || '';
      bricks.push(buildConstantBrick(row.targetPath, val, 200, y, 50, y));
    } else if (type === 'custom') {
      // Named transformation rule — do direct mapping but mark as switched-off
      // (requires manual implementation in CPI)
      if (row.sourcePath) {
        bricks.push(buildCustomRuleBrick(row.targetPath, row.sourcePath, row.comments || row.transformationRule, 200, y, 50, y));
      }
    } else {
      // Direct one-to-one
      if (row.sourcePath) {
        bricks.push(buildDirectBrick(row.targetPath, row.sourcePath, 200, y, 50, y));
      }
    }

    y += 28;
  }

  return bricks.join('');
}

function buildDirectBrick(dstPath, srcPath, dstX, dstY, srcX, srcY) {
  return `<brick gid="0" path="${escapeXml(dstPath)}" type="Dst"><viewData x="${dstX}" y="${dstY}"/><arg><brick gid="0" path="${escapeXml(srcPath)}" type="Src"><viewData x="${srcX}" y="${srcY}"/></brick></arg><group/></brick>`;
}

function buildConstantBrick(dstPath, value, dstX, dstY, srcX, srcY) {
  return `<brick gid="0" path="${escapeXml(dstPath)}" type="Dst"><viewData x="${dstX}" y="${dstY}"/><arg><brick gid="2" path="Constant" type="Func"><viewData x="${srcX}" y="${srcY}"/><arg><value>${escapeXml(value)}</value></arg></brick></arg><group/></brick>`;
}

function buildCustomRuleBrick(dstPath, srcPath, ruleName, dstX, dstY, srcX, srcY) {
  // Direct mapping with switchedOff=true — needs manual wiring in CPI designer
  return `<brick gid="0" path="${escapeXml(dstPath)}" type="Dst"><viewData x="${dstX}" y="${dstY}"/><arg><brick gid="0" path="${escapeXml(srcPath)}" type="Src"><viewData x="${srcX}" y="${srcY}"/></brick></arg><properties><property name="switchedOff">true</property></properties><group/></brick>`;
}

async function zipFolder(sourceDir, outputZipPath) {
  await new Promise((resolve, reject) => {
    const output = fs.createWriteStream(outputZipPath);
    const archive = new ZipArchive({ zlib: { level: 9 } });

    output.on('close', resolve);
    output.on('error', reject);
    archive.on('error', reject);
    archive.on('warning', reject);

    archive.pipe(output);
    addDirectoryContentsToZip(archive, sourceDir, '');
    archive.finalize();
  });
}

function addDirectoryContentsToZip(archive, currentDir, zipPrefix = '') {
  const entries = fs.readdirSync(currentDir);

  for (const entry of entries) {
    const fullPath = path.join(currentDir, entry);
    const stats = fs.statSync(fullPath);
    const nextZipPath = zipPrefix ? `${zipPrefix}/${entry}` : entry;

    if (stats.isDirectory()) {
      addDirectoryContentsToZip(archive, fullPath, nextZipPath);
    } else {
      archive.append(fs.readFileSync(fullPath), { name: nextZipPath });
    }
  }
}

export function buildGroovyScript(mappingName, rows) {
  const direct = rows.filter(r => r.transformationType === 'direct' && r.sourceElementName && r.targetElementName);
  const constants = rows.filter(r => r.transformationType === 'constant' && r.targetElementName);
  const custom = rows.filter(r => r.transformationType === 'custom' && r.targetElementName);

  const directLines = direct.map(r =>
    `    targetMsg.${r.targetElementName} = sourceMsg.${r.sourceElementName}  // ${r.sourceDescription || r.sourceFieldName}`
  ).join('\n');

  const constantLines = constants.map(r =>
    `    targetMsg.${r.targetElementName} = "${escapeXml(r.constantValue || r.comments || '')}"  // Hardcoded constant`
  ).join('\n');

  const customLines = custom.map(r =>
    `    // TODO: Implement rule '${r.comments || r.transformationRule}' for field ${r.targetElementName}\n    // Source: ${r.sourceElementName || 'N/A'}\n    targetMsg.${r.targetElementName} = sourceMsg.${r.sourceElementName || r.targetElementName}`
  ).join('\n');

  return `import com.sap.gateway.ip.core.customdev.util.Message
import java.util.HashMap

/**
 * Groovy Mapping Script: ${mappingName}
 * Generated by SAP CPI AI Control Center
 *
 * Direct mappings   : ${direct.length}
 * Constant values   : ${constants.length}
 * Custom rules (TODO): ${custom.length}
 */
def Message processData(Message message) {
    def body = message.getBody(String.class)
    def sourceXml = new XmlSlurper().parseText(body)
    def targetBuilder = new groovy.xml.StreamingMarkupBuilder()

    def result = targetBuilder.bind {
        mkp.xmlDeclaration()
        root {
${direct.map(r => `            ${r.targetElementName}(sourceXml.${r.sourceElementName}?.text() ?: '')`).join('\n')}
${constants.map(r => `            ${r.targetElementName}("${r.constantValue || r.comments || ''}")`).join('\n')}
${custom.map(r => `            // TODO [${r.comments || r.transformationRule}]: ${r.targetElementName}\n            ${r.targetElementName}(sourceXml.${r.sourceElementName || r.targetElementName}?.text() ?: '')`).join('\n')}
        }
    }

    message.setBody(groovy.xml.XmlUtil.serialize(result))
    return message
}
`;
}

function escapeXml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}