import fs from 'fs';
import path from 'path';
import fse from 'fs-extra';
import { ZipArchive } from 'archiver';
import { v4 as uuidv4 } from 'uuid';
import { STEP_LIBRARY } from './iflowStepLibrary.js';

const TEMPLATE_BASE_DIR = path.join(process.cwd(), 'iflow-template', 'base');
const GENERATED_DIR = path.join(process.cwd(), 'generated');

export async function buildIflowFromTemplate(spec) {
  console.log('[TEMPLATE] Using template folder:', TEMPLATE_BASE_DIR);
  console.log('[TEMPLATE] iflowName:', spec?.iflowName);

  if (!spec?.iflowName) {
    throw new Error('iflowName is required in spec');
  }

  if (!fs.existsSync(TEMPLATE_BASE_DIR)) {
    throw new Error(`Template folder not found: ${TEMPLATE_BASE_DIR}`);
  }

  validateTemplateStructure(TEMPLATE_BASE_DIR);

  const iflowName = sanitizeName(spec.iflowName);

  await fse.ensureDir(GENERATED_DIR);

  const tempProjectDir = path.join(GENERATED_DIR, `tmp_${uuidv4()}`);
  await fse.copy(TEMPLATE_BASE_DIR, tempProjectDir);

  patchRootFiles(tempProjectDir, spec, iflowName);
  patchIflowFile(tempProjectDir, spec, iflowName);
  patchMappingAndAssets(tempProjectDir, spec);
  patchScripts(tempProjectDir, spec);
  patchParameters(tempProjectDir, spec);

  const zipPath = path.join(GENERATED_DIR, `${iflowName}.zip`);

  await zipProjectContents(tempProjectDir, zipPath);

  console.log('[TEMPLATE] ZIP created at:', zipPath);

  await fse.remove(tempProjectDir);

  return {
    fileName: path.basename(zipPath),
    zipPath
  };
}

function validateTemplateStructure(templateDir) {
  const required = [
    '.project',
    'metainfo.prop',
    path.join('META-INF', 'MANIFEST.MF'),
    path.join('src', 'main', 'resources', 'scenarioflows', 'integrationflow')
  ];

  const missing = required.filter((relPath) => {
    return !fs.existsSync(path.join(templateDir, relPath));
  });

  if (missing.length) {
    throw new Error(
      `Template folder is invalid. Missing: ${missing.join(', ')}`
    );
  }
}

function sanitizeName(name) {
  return String(name || '')
    .trim()
    .replace(/[^\w.-]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function patchRootFiles(projectDir, spec, iflowName) {
  patchManifest(projectDir, iflowName);
  patchProjectFile(projectDir, iflowName);
  patchMetainfo(projectDir, spec.description || iflowName);
}

function patchManifest(projectDir, iflowName) {
  const manifestPath = path.join(projectDir, 'META-INF', 'MANIFEST.MF');
  let text = fs.readFileSync(manifestPath, 'utf-8');

  text = replaceOrAddManifest(text, 'Bundle-SymbolicName', iflowName);
  text = replaceOrAddManifest(text, 'Bundle-Name', iflowName);
  text = replaceOrAddManifest(text, 'Origin-Bundle-SymbolicName', iflowName);
  text = replaceOrAddManifest(text, 'Origin-Bundle-Name', iflowName);
  text = replaceOrAddManifest(text, 'Bundle-Version', '1.0.0');
  text = replaceOrAddManifest(text, 'Bundle-ManifestVersion', '2');
  text = replaceOrAddManifest(text, 'SAP-BundleType', 'IntegrationFlow');
  text = replaceOrAddManifest(text, 'SAP-NodeType', 'IFLMAP');
  text = replaceOrAddManifest(text, 'SAP-RuntimeProfile', 'iflmap');

  fs.writeFileSync(manifestPath, text, 'utf-8');
}

function replaceOrAddManifest(content, key, value) {
  const regex = new RegExp(`^${escapeRegex(key)}:.*$`, 'm');
  if (regex.test(content)) {
    return content.replace(regex, `${key}: ${value}`);
  }
  return content.trimEnd() + `\n${key}: ${value}\n`;
}

function patchProjectFile(projectDir, iflowName) {
  const filePath = path.join(projectDir, '.project');
  let text = fs.readFileSync(filePath, 'utf-8');
  text = text.replace(/<name>.*?<\/name>/, `<name>${iflowName}</name>`);
  fs.writeFileSync(filePath, text, 'utf-8');
}

function patchMetainfo(projectDir, description) {
  const filePath = path.join(projectDir, 'metainfo.prop');
  let text = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf-8') : '';

  if (/^description=/m.test(text)) {
    text = text.replace(/^description=.*$/m, `description=${escapeJavaProp(description)}`);
  } else {
    text += `\ndescription=${escapeJavaProp(description)}\n`;
  }

  fs.writeFileSync(filePath, text.trim() + '\n', 'utf-8');
}

function escapeJavaProp(value) {
  return String(value || '').replace(/:/g, '\\:');
}

function patchIflowFile(projectDir, spec, iflowName) {
  const iflowDir = path.join(
    projectDir,
    'src',
    'main',
    'resources',
    'scenarioflows',
    'integrationflow'
  );

  const existing = fs.readdirSync(iflowDir).find((f) => f.endsWith('.iflw'));
  if (!existing) {
    throw new Error('Template .iflw file not found');
  }

  const oldName = existing.replace(/\.iflw$/i, '');
  const oldPath = path.join(iflowDir, existing);
  const newPath = path.join(iflowDir, `${iflowName}.iflw`);

  let xml = fs.readFileSync(oldPath, 'utf-8');

  xml = xml.replace(new RegExp(escapeRegex(oldName), 'g'), iflowName);

  if (spec.description) {
    xml = xml.replace(
      /<bpmn2:documentation[^>]*>[\s\S]*?<\/bpmn2:documentation>/,
      `<bpmn2:documentation id="Documentation_1" textFormat="text/plain">${escapeXml(spec.description)}</bpmn2:documentation>`
    );
  }

  xml = applyProcessModel(xml, spec.steps || []);
  xml = applyMessageFlows(xml, spec.messageFlows || []);
  xml = applyExceptionSubprocess(xml, spec.exceptionSubprocess || null);

  fs.writeFileSync(newPath, xml, 'utf-8');

  if (oldPath !== newPath && fs.existsSync(oldPath)) {
    fs.unlinkSync(oldPath);
  }
}

function applyProcessModel(xml, steps) {
  const generated = generateProcessModel(steps);

  xml = xml.replace('<!-- @@PROCESS_STEPS@@ -->', generated.processSteps || '');
  xml = xml.replace('<!-- @@SEQUENCE_FLOWS@@ -->', generated.sequenceFlows || '');
  xml = xml.replace('<!-- @@BPMN_SHAPES@@ -->', generated.shapes || '');
  xml = xml.replace('<!-- @@BPMN_EDGES@@ -->', generated.edges || '');

  // Update StartEvent outgoing
  xml = xml.replace(
    /<bpmn2:startEvent([\s\S]*?)<\/bpmn2:startEvent>/,
    (match) => {
      return match
        .replace(/<bpmn2:outgoing>.*?<\/bpmn2:outgoing>/g, '')
        .replace(
          /(<bpmn2:messageEventDefinition\/>)/,
          `${generated.startOutgoingXml}\n            $1`
        );
    }
  );

  // Update EndEvent incoming
  xml = xml.replace(
    /<bpmn2:endEvent([\s\S]*?)<\/bpmn2:endEvent>/,
    (match) => {
      return match
        .replace(/<bpmn2:incoming>.*?<\/bpmn2:incoming>/g, '')
        .replace(
          /(<bpmn2:messageEventDefinition\/>)/,
          `${generated.endIncomingXml}\n            $1`
        );
    }
  );

  // ✅ Reposition STATIC EndEvent shape instead of creating a duplicate
  xml = xml.replace(
    /<bpmndi:BPMNShape bpmnElement="EndEvent_1" id="BPMNShape_EndEvent_1">[\s\S]*?<dc:Bounds height="32\.0" width="32\.0" x="[^"]+" y="144\.0"\/>[\s\S]*?<\/bpmndi:BPMNShape>/,
    `
            <bpmndi:BPMNShape bpmnElement="EndEvent_1" id="BPMNShape_EndEvent_1">
                <dc:Bounds height="32.0" width="32.0" x="${generated.endShapeX}.0" y="144.0"/>
            </bpmndi:BPMNShape>
    `.trim()
  );

  return xml;
}

function applyMessageFlows(xml, messageFlows) {
  const msgXml = generateMessageFlowBlocks(messageFlows);
  return xml.replace('<!-- @@MESSAGE_FLOWS@@ -->', msgXml);
}

function applyExceptionSubprocess(xml, exceptionSubprocess) {
  if (!exceptionSubprocess?.enabled) {
    return xml.replace('<!-- @@EXCEPTION_SUBPROCESS@@ -->', '');
  }

  const block = `
        <bpmn2:subProcess id="SubProcess_Error" name="Exception Subprocess">
            <bpmn2:extensionElements>
                <ifl:property>
                    <key>componentVersion</key>
                    <value>1.1</value>
                </ifl:property>
                <ifl:property>
                    <key>activityType</key>
                    <value>ErrorEventSubProcessTemplate</value>
                </ifl:property>
                <ifl:property>
                    <key>cmdVariantUri</key>
                    <value>ctype::FlowstepVariant/cname::ErrorEventSubProcessTemplate/version::1.0.2</value>
                </ifl:property>
            </bpmn2:extensionElements>

            <bpmn2:startEvent id="ErrorStartEvent_1" name="Error Start">
                <bpmn2:outgoing>ErrorFlow_1</bpmn2:outgoing>
                <bpmn2:errorEventDefinition>
                    <bpmn2:extensionElements>
                        <ifl:property>
                            <key>cmdVariantUri</key>
                            <value>ctype::FlowstepVariant/cname::ErrorStartEvent</value>
                        </ifl:property>
                        <ifl:property>
                            <key>activityType</key>
                            <value>StartErrorEvent</value>
                        </ifl:property>
                    </bpmn2:extensionElements>
                </bpmn2:errorEventDefinition>
            </bpmn2:startEvent>

            <bpmn2:callActivity id="CallActivity_HandleError" name="Handle Error">
                <bpmn2:extensionElements>
                    <ifl:property>
                        <key>scriptFunction</key>
                        <value>processData</value>
                    </ifl:property>
                    <ifl:property>
                        <key>componentVersion</key>
                        <value>1.1</value>
                    </ifl:property>
                    <ifl:property>
                        <key>activityType</key>
                        <value>Script</value>
                    </ifl:property>
                    <ifl:property>
                        <key>cmdVariantUri</key>
                        <value>ctype::FlowstepVariant/cname::GroovyScript/version::1.1.2</value>
                    </ifl:property>
                    <ifl:property>
                        <key>subActivityType</key>
                        <value>GroovyScript</value>
                    </ifl:property>
                    <ifl:property>
                        <key>script</key>
                        <value>HandleError.groovy</value>
                    </ifl:property>
                </bpmn2:extensionElements>
                <bpmn2:incoming>ErrorFlow_1</bpmn2:incoming>
                <bpmn2:outgoing>ErrorFlow_2</bpmn2:outgoing>
            </bpmn2:callActivity>

            ${exceptionSubprocess.mailAdapter ? `
            <bpmn2:serviceTask id="ServiceTask_SendMail" name="Send Mail Alert">
                <bpmn2:extensionElements>
                    <ifl:property>
                        <key>activityType</key>
                        <value>ExternalCall</value>
                    </ifl:property>
                    <ifl:property>
                        <key>componentVersion</key>
                        <value>1.0</value>
                    </ifl:property>
                    <ifl:property>
                        <key>cmdVariantUri</key>
                        <value>ctype::FlowstepVariant/cname::ExternalCall/version::1.0.4</value>
                    </ifl:property>
                </bpmn2:extensionElements>
                <bpmn2:incoming>ErrorFlow_2</bpmn2:incoming>
                <bpmn2:outgoing>ErrorFlow_3</bpmn2:outgoing>
            </bpmn2:serviceTask>
            ` : ''}

            <bpmn2:endEvent id="ErrorEndEvent_1" name="Error End">
                <bpmn2:incoming>${exceptionSubprocess.mailAdapter ? 'ErrorFlow_3' : 'ErrorFlow_2'}</bpmn2:incoming>
                <bpmn2:errorEventDefinition>
                    <bpmn2:extensionElements>
                        <ifl:property>
                            <key>cmdVariantUri</key>
                            <value>ctype::FlowstepVariant/cname::ErrorEndEvent</value>
                        </ifl:property>
                        <ifl:property>
                            <key>activityType</key>
                            <value>EndErrorEvent</value>
                        </ifl:property>
                    </bpmn2:extensionElements>
                </bpmn2:errorEventDefinition>
            </bpmn2:endEvent>

            <bpmn2:sequenceFlow id="ErrorFlow_1" sourceRef="ErrorStartEvent_1" targetRef="CallActivity_HandleError"/>
            ${exceptionSubprocess.mailAdapter
              ? `<bpmn2:sequenceFlow id="ErrorFlow_2" sourceRef="CallActivity_HandleError" targetRef="ServiceTask_SendMail"/>
                 <bpmn2:sequenceFlow id="ErrorFlow_3" sourceRef="ServiceTask_SendMail" targetRef="ErrorEndEvent_1"/>`
              : `<bpmn2:sequenceFlow id="ErrorFlow_2" sourceRef="CallActivity_HandleError" targetRef="ErrorEndEvent_1"/>`
            }
        </bpmn2:subProcess>
  `;

  return xml.replace('<!-- @@EXCEPTION_SUBPROCESS@@ -->', block);
}

function generateProcessModel(steps) {
  const processSteps = [];
  const sequenceFlows = [];
  const shapes = [];
  const edges = [];

  const startX = 180;
  const startCenterX = 196;
  const firstStepX = 280;
  const stepY = 130;
  const centerY = 160;
  const stepGap = 170;
  const endPadding = 150;

  let previousRef = 'StartEvent_1';
  let previousCenterX = startCenterX;

  if (!steps.length) {
    const endX = startX + 170;
    const endCenterX = endX + 16;

    sequenceFlows.push(
      `<bpmn2:sequenceFlow id="SequenceFlow_1" sourceRef="StartEvent_1" targetRef="EndEvent_1"/>`
    );

    edges.push(`
            <bpmndi:BPMNEdge bpmnElement="SequenceFlow_1" id="BPMNEdge_SequenceFlow_1">
                <di:waypoint x="${startCenterX}.0" xsi:type="dc:Point" y="${centerY}.0"/>
                <di:waypoint x="${endCenterX}.0" xsi:type="dc:Point" y="${centerY}.0"/>
            </bpmndi:BPMNEdge>
    `.trim());

    return {
      processSteps: '',
      sequenceFlows: sequenceFlows.join('\n'),
      shapes: '',
      edges: edges.join('\n'),
      startOutgoingXml: `<bpmn2:outgoing>SequenceFlow_1</bpmn2:outgoing>`,
      endIncomingXml: `<bpmn2:incoming>SequenceFlow_1</bpmn2:incoming>`,
      endShapeX: endX
    };
  }

  steps.forEach((step, index) => {
    const lib = STEP_LIBRARY[step.type];
    if (!lib) return;

    const elementId =
      lib.stepType === 'serviceTask'
        ? `ServiceTask_${step.type}_${index + 1}`
        : `CallActivity_${step.type}_${index + 1}`;

    const x = firstStepX + index * stepGap;
    const width = lib.width || 100;
    const centerX = x + width / 2;

    const incomingId = `SequenceFlow_${index + 1}`;
    const outgoingId = `SequenceFlow_${index + 2}`; // includes final flow for last step

    const stepXml = `
        <bpmn2:${lib.stepType} id="${elementId}" name="${escapeXml(step.name || step.type)}">
            <bpmn2:extensionElements>
                ${Object.entries(lib.properties || {})
                  .map(([k, v]) => `<ifl:property><key>${k}</key><value>${escapeXml(v)}</value></ifl:property>`)
                  .join('')}
                ${step.scriptFile ? `<ifl:property><key>script</key><value>${escapeXml(step.scriptFile)}</value></ifl:property>` : ''}
                ${step.mappingName ? `<ifl:property><key>mappingname</key><value>${escapeXml(step.mappingName)}</value></ifl:property>` : ''}
                ${step.mappingPath ? `<ifl:property><key>mappingpath</key><value>${escapeXml(step.mappingPath)}</value></ifl:property>` : ''}
            </bpmn2:extensionElements>
            <bpmn2:incoming>${incomingId}</bpmn2:incoming>
            <bpmn2:outgoing>${outgoingId}</bpmn2:outgoing>
        </bpmn2:${lib.stepType}>
    `.trim();

    processSteps.push(stepXml);

    sequenceFlows.push(
      `<bpmn2:sequenceFlow id="${incomingId}" sourceRef="${previousRef}" targetRef="${elementId}"/>`
    );

    edges.push(`
            <bpmndi:BPMNEdge bpmnElement="${incomingId}" id="BPMNEdge_${incomingId}">
                <di:waypoint x="${previousCenterX}.0" xsi:type="dc:Point" y="${centerY}.0"/>
                <di:waypoint x="${centerX}.0" xsi:type="dc:Point" y="${centerY}.0"/>
            </bpmndi:BPMNEdge>
    `.trim());

    shapes.push(`
            <bpmndi:BPMNShape bpmnElement="${elementId}" id="BPMNShape_${elementId}">
                <dc:Bounds height="60.0" width="${width}.0" x="${x}.0" y="${stepY}.0"/>
            </bpmndi:BPMNShape>
    `.trim());

    previousRef = elementId;
    previousCenterX = centerX;
  });

  const endX = firstStepX + (steps.length * stepGap) + endPadding;
  const endCenterX = endX + 16;
  const finalFlowId = `SequenceFlow_${steps.length + 1}`;

  sequenceFlows.push(
    `<bpmn2:sequenceFlow id="${finalFlowId}" sourceRef="${previousRef}" targetRef="EndEvent_1"/>`
  );

  edges.push(`
            <bpmndi:BPMNEdge bpmnElement="${finalFlowId}" id="BPMNEdge_${finalFlowId}">
                <di:waypoint x="${previousCenterX}.0" xsi:type="dc:Point" y="${centerY}.0"/>
                <di:waypoint x="${endCenterX}.0" xsi:type="dc:Point" y="${centerY}.0"/>
            </bpmndi:BPMNEdge>
  `.trim());

  return {
    processSteps: processSteps.join('\n'),
    sequenceFlows: sequenceFlows.join('\n'),
    shapes: shapes.join('\n'),
    edges: edges.join('\n'),
    startOutgoingXml: `<bpmn2:outgoing>SequenceFlow_1</bpmn2:outgoing>`,
    endIncomingXml: `<bpmn2:incoming>${finalFlowId}</bpmn2:incoming>`,
    endShapeX: endX
  };
}

function generateMessageFlowBlocks(messageFlows) {
  return messageFlows
    .map((mf, idx) => `
        <bpmn2:messageFlow id="MessageFlow_DYNAMIC_${idx + 1}" name="${escapeXml(mf.name || mf.type || 'Adapter')}" sourceRef="${escapeXml(mf.sourceRef)}" targetRef="${escapeXml(mf.targetRef)}">
            <bpmn2:extensionElements>
                <ifl:property><key>ComponentType</key><value>${escapeXml(mf.componentType || 'HTTP')}</value></ifl:property>
                <ifl:property><key>TransportProtocol</key><value>${escapeXml(mf.transportProtocol || 'HTTP')}</value></ifl:property>
                <ifl:property><key>direction</key><value>${escapeXml(mf.direction || 'Receiver')}</value></ifl:property>
            </bpmn2:extensionElements>
        </bpmn2:messageFlow>
    `)
    .join('\n');
}

function patchMappingAndAssets(projectDir, spec) {
  const mappingDir = path.join(projectDir, 'src', 'main', 'resources', 'mapping');
  const xsdDir = path.join(projectDir, 'src', 'main', 'resources', 'xsd');
  const wsdlDir = path.join(projectDir, 'src', 'main', 'resources', 'wsdl');

  fse.ensureDirSync(mappingDir);
  fse.ensureDirSync(xsdDir);
  fse.ensureDirSync(wsdlDir);

  if (spec.mapping?.mmapFile && spec.mapping?.mmapContent) {
    fs.writeFileSync(
      path.join(mappingDir, spec.mapping.mmapFile),
      spec.mapping.mmapContent,
      'utf-8'
    );
  }

  if (spec.mapping?.sourceXsd && spec.mapping?.sourceXsdContent) {
    fs.writeFileSync(
      path.join(wsdlDir, spec.mapping.sourceXsd),
      spec.mapping.sourceXsdContent,
      'utf-8'
    );
  }

  if (spec.mapping?.targetXsd && spec.mapping?.targetXsdContent) {
    fs.writeFileSync(
      path.join(xsdDir, spec.mapping.targetXsd),
      spec.mapping.targetXsdContent,
      'utf-8'
    );
  }
}

function patchScripts(projectDir, spec) {
  const scriptDir = path.join(projectDir, 'src', 'main', 'resources', 'script');
  fse.ensureDirSync(scriptDir);

  for (const script of spec.scripts || []) {
    fs.writeFileSync(
      path.join(scriptDir, script.fileName),
      script.content,
      'utf-8'
    );
  }
}

function patchParameters(projectDir, spec) {
  const resourceDir = path.join(projectDir, 'src', 'main', 'resources');
  fse.ensureDirSync(resourceDir);

  if (spec.parametersProp) {
    fs.writeFileSync(
      path.join(resourceDir, 'parameters.prop'),
      spec.parametersProp,
      'utf-8'
    );
  }

  if (spec.parametersPropdef) {
    fs.writeFileSync(
      path.join(resourceDir, 'parameters.propdef'),
      spec.parametersPropdef,
      'utf-8'
    );
  }
}

async function zipProjectContents(sourceDir, outputZipPath) {
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

function escapeXml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function escapeRegex(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}