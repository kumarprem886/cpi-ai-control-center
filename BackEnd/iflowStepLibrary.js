// ======================================================
// SAP CPI standard flow steps — corpus-verified
//
// Every activityType / cmdVariantUri / componentVersion below was extracted
// from 206 unique SAP-authored .iflw files (SAP standard content packages plus
// real tenant exports). Where several versions exist in the wild, the modal one
// is used. A wrong cmdVariantUri makes CPI render the step as unknown or refuse
// the artifact, so nothing here is inferred.
//
// Only steps that can sit in the process chain are listed. Events, subprocesses
// and the process/collaboration containers live in the template, not here.
//
// SAP's own misspellings are preserved deliberately: participant type
// "EndpointRecevier", and "Encryption_Algorithem" on the PKCS7 encryptor.
//
// thin: true marks a step resting on only 1-2 files in the corpus. It is
// emitted, but is the first place to look if CPI rejects a flow.
// ======================================================

const FLOWSTEP = (cname, version) =>
  `ctype::FlowstepVariant/cname::${cname}` + (version ? `/version::${version}` : '');

export const STEP_LIBRARY = {
  // ── Transformation ────────────────────────────────────
  CONTENT_MODIFIER: {
    stepType: 'callActivity',
    width: 100,
    properties: {
      componentVersion: '1.5',
      activityType: 'Enricher',
      cmdVariantUri: FLOWSTEP('Enricher', '1.5.1'),
      bodyType: 'expression',
      wrapContent: '',
      propertyTable: '',
      headerTable: ''
    }
  },

  MESSAGE_MAPPING: {
    stepType: 'callActivity',
    width: 100,
    properties: {
      componentVersion: '1.3',
      activityType: 'Mapping',
      cmdVariantUri: FLOWSTEP('MessageMapping', '1.3.1'),
      mappingType: 'MessageMapping',
      mappingReference: 'static'
    }
  },

  XSLT_MAPPING: {
    stepType: 'callActivity',
    width: 100,
    properties: {
      componentVersion: '1.2',
      activityType: 'Mapping',
      subActivityType: 'XSLTMapping',
      cmdVariantUri: FLOWSTEP('XSLTMapping', '1.2.0'),
      mappingSource: 'mappingSrcIflow',
      mappingoutputformat: 'Bytes'
    }
  },

  GROOVY_SCRIPT: {
    stepType: 'callActivity',
    width: 100,
    properties: {
      componentVersion: '1.1',
      activityType: 'Script',
      subActivityType: 'GroovyScript',
      cmdVariantUri: FLOWSTEP('GroovyScript', '1.1.2'),
      scriptFunction: 'processData'
    }
  },

  JAVASCRIPT: {
    stepType: 'callActivity',
    width: 100,
    properties: {
      componentVersion: '1.1',
      activityType: 'Script',
      subActivityType: 'JavaScript',
      cmdVariantUri: FLOWSTEP('JavaScript', '1.1.2'),
      scriptFunction: 'processData'
    }
  },

  FILTER: {
    stepType: 'callActivity',
    width: 100,
    properties: {
      componentVersion: '1.1',
      activityType: 'Filter',
      cmdVariantUri: FLOWSTEP('Filter', '1.1.0'),
      xpathType: 'Nodelist',
      wrapContent: ''
    }
  },

  XML_MODIFIER: {
    stepType: 'callActivity',
    width: 100,
    properties: {
      componentVersion: '1.0',
      activityType: 'XmlModifier',
      cmdVariantUri: FLOWSTEP('XmlModifier', '1.0.0')
    }
  },

  // ── Converters ────────────────────────────────────────
  JSON_TO_XML: {
    stepType: 'callActivity',
    width: 100,
    properties: {
      componentVersion: '1.1',
      activityType: 'JsonToXmlConverter',
      cmdVariantUri: FLOWSTEP('JsonToXmlConverter', '1.1.2')
    }
  },

  XML_TO_JSON: {
    stepType: 'callActivity',
    width: 100,
    properties: {
      componentVersion: '1.0',
      activityType: 'XmlToJsonConverter',
      cmdVariantUri: FLOWSTEP('XmlToJsonConverter', '1.0.8')
    }
  },

  XML_TO_CSV: {
    stepType: 'callActivity',
    width: 100,
    properties: {
      componentVersion: '1.2',
      activityType: 'XmlToCsvConverter',
      cmdVariantUri: FLOWSTEP('XmlToCsvConverter', '1.2.0')
    }
  },

  // The single corpus occurrence carries no componentVersion and an unversioned
  // URI; reproduced exactly rather than inventing a version.
  CSV_TO_XML: {
    stepType: 'callActivity',
    width: 100,
    thin: true,
    properties: {
      activityType: 'CsvToXmlConverter',
      cmdVariantUri: FLOWSTEP('CsvToXmlConverter')
    }
  },

  BASE64_ENCODER: {
    stepType: 'callActivity',
    width: 100,
    properties: {
      componentVersion: '1.0',
      activityType: 'Encoder',
      cmdVariantUri: FLOWSTEP('Base64 Encode', '1.0.1'),
      encoderType: 'base64'
    }
  },

  BASE64_DECODER: {
    stepType: 'callActivity',
    width: 100,
    properties: {
      componentVersion: '1.0',
      activityType: 'Decoder',
      cmdVariantUri: FLOWSTEP('Base64 Decode', '1.0.1'),
      decoderType: 'base64'
    }
  },

  ZIP_ENCODER: {
    stepType: 'callActivity',
    width: 100,
    thin: true,
    properties: {
      componentVersion: '1.0',
      activityType: 'Encoder',
      cmdVariantUri: FLOWSTEP('ZIP Compress', '1.0.1')
    }
  },

  ZIP_DECODER: {
    stepType: 'callActivity',
    width: 100,
    thin: true,
    properties: {
      componentVersion: '1.0',
      activityType: 'Decoder',
      cmdVariantUri: FLOWSTEP('ZIP Decompress', '1.0.2')
    }
  },

  // ── Splitters / gather ────────────────────────────────
  GENERAL_SPLITTER: {
    stepType: 'callActivity',
    width: 100,
    properties: {
      componentVersion: '1.5',
      activityType: 'Splitter',
      cmdVariantUri: FLOWSTEP('GeneralSplitter', '1.5.1'),
      splitType: 'GeneralSplitter'
    }
  },

  // The Iterating Splitter serializes as cname::Camel; the palette name only
  // survives in the splitType property.
  ITERATING_SPLITTER: {
    stepType: 'callActivity',
    width: 100,
    properties: {
      componentVersion: '1.5',
      activityType: 'Splitter',
      cmdVariantUri: FLOWSTEP('Camel', '1.5.1'),
      splitType: 'IteratingSplitter'
    }
  },

  ZIP_SPLITTER: {
    stepType: 'callActivity',
    width: 100,
    properties: {
      componentVersion: '1.0',
      activityType: 'Splitter',
      cmdVariantUri: FLOWSTEP('ZipSplitter', '1.0.0'),
      splitType: 'ZipSplitter'
    }
  },

  GATHER: {
    stepType: 'callActivity',
    width: 100,
    properties: {
      componentVersion: '1.2',
      activityType: 'Gather',
      cmdVariantUri: FLOWSTEP('Gather', '1.2.0')
    }
  },

  AGGREGATOR: {
    stepType: 'callActivity',
    width: 100,
    thin: true,
    properties: {
      componentVersion: '1.0',
      activityType: 'Aggregator',
      cmdVariantUri: FLOWSTEP('Aggregator', '1.0.5')
    }
  },

  // ── Process calls ─────────────────────────────────────
  PROCESS_CALL: {
    stepType: 'callActivity',
    width: 100,
    properties: {
      componentVersion: '1.0',
      activityType: 'ProcessCallElement',
      subActivityType: 'NonLoopingProcess',
      cmdVariantUri: FLOWSTEP('NonLoopingProcess', '1.0.3')
    }
  },

  LOOPING_PROCESS_CALL: {
    stepType: 'callActivity',
    width: 100,
    properties: {
      componentVersion: '1.3',
      activityType: 'ProcessCallElement',
      subActivityType: 'LoopingProcess',
      cmdVariantUri: FLOWSTEP('LoopingProcess', '1.3.0')
    }
  },

  IDEMPOTENT_PROCESS_CALL: {
    stepType: 'callActivity',
    width: 100,
    thin: true,
    properties: {
      componentVersion: '1.0',
      activityType: 'IdempotentProcessCall',
      cmdVariantUri: FLOWSTEP('IdempotentProcessCall', '1.0.0')
    }
  },

  // ── Persistence ───────────────────────────────────────
  // Data Store cname is the lowercase operation, matching the operation prop.
  DATA_STORE_WRITE: {
    stepType: 'callActivity',
    width: 100,
    properties: {
      componentVersion: '1.7',
      activityType: 'DBstorage',
      cmdVariantUri: FLOWSTEP('put', '1.7.1'),
      operation: 'put'
    }
  },

  DATA_STORE_GET: {
    stepType: 'callActivity',
    width: 100,
    properties: {
      componentVersion: '1.7',
      activityType: 'DBstorage',
      cmdVariantUri: FLOWSTEP('get', '1.7.1'),
      operation: 'get'
    }
  },

  DATA_STORE_SELECT: {
    stepType: 'callActivity',
    width: 100,
    properties: {
      componentVersion: '1.7',
      activityType: 'DBstorage',
      cmdVariantUri: FLOWSTEP('select', '1.7.1'),
      operation: 'select'
    }
  },

  DATA_STORE_DELETE: {
    stepType: 'callActivity',
    width: 100,
    properties: {
      componentVersion: '1.7',
      activityType: 'DBstorage',
      cmdVariantUri: FLOWSTEP('delete', '1.7.1'),
      operation: 'delete'
    }
  },

  WRITE_VARIABLES: {
    stepType: 'callActivity',
    width: 100,
    properties: {
      componentVersion: '1.2',
      activityType: 'Variables',
      cmdVariantUri: FLOWSTEP('Variables', '1.2.0')
    }
  },

  PERSIST_MESSAGE: {
    stepType: 'callActivity',
    width: 100,
    properties: {
      componentVersion: '1.0',
      activityType: 'Persist',
      cmdVariantUri: FLOWSTEP('Persist', '1.0.2')
    }
  },

  ID_MAPPER: {
    stepType: 'callActivity',
    width: 100,
    thin: true,
    properties: {
      componentVersion: '1.0',
      activityType: 'IDMapper',
      cmdVariantUri: FLOWSTEP('IDMapper', '1.0.0')
    }
  },

  // ── Security ──────────────────────────────────────────
  MESSAGE_DIGEST: {
    stepType: 'callActivity',
    width: 100,
    thin: true,
    properties: {
      componentVersion: '1.1',
      activityType: 'MessageDigest',
      cmdVariantUri: FLOWSTEP('MessageDigest', '1.1.1')
    }
  },

  PKCS7_ENCRYPTOR: {
    stepType: 'callActivity',
    width: 100,
    thin: true,
    properties: {
      componentVersion: '1.3',
      activityType: 'Encrypt',
      cmdVariantUri: FLOWSTEP('Encrypt', '1.3.0')
    }
  },

  PKCS7_DECRYPTOR: {
    stepType: 'callActivity',
    width: 100,
    thin: true,
    properties: {
      componentVersion: '1.2',
      activityType: 'Decrypt',
      cmdVariantUri: FLOWSTEP('Decrypt', '1.2.0')
    }
  },

  PGP_ENCRYPTOR: {
    stepType: 'callActivity',
    width: 100,
    properties: {
      componentVersion: '1.3',
      activityType: 'PgpEncrypt',
      cmdVariantUri: FLOWSTEP('PgpEncrypt', '1.3.0')
    }
  },

  PGP_DECRYPTOR: {
    stepType: 'callActivity',
    width: 100,
    properties: {
      componentVersion: '1.2',
      activityType: 'PgpDecrypt',
      cmdVariantUri: FLOWSTEP('PgpDecrypt', '1.2.0')
    }
  },

  SIMPLE_SIGNER: {
    stepType: 'callActivity',
    width: 100,
    thin: true,
    properties: {
      componentVersion: '1.3',
      activityType: 'SimpleSignMessage',
      cmdVariantUri: FLOWSTEP('SimpleSignMessage', '1.3.0')
    }
  },

  XML_SIGNATURE_VERIFIER: {
    stepType: 'callActivity',
    width: 100,
    thin: true,
    properties: {
      componentVersion: '1.1',
      activityType: 'XMLDigitalVerifySign',
      cmdVariantUri: FLOWSTEP('XMLDigitalVerifySign', '1.1.0')
    }
  },

  XML_VALIDATOR: {
    stepType: 'callActivity',
    width: 100,
    thin: true,
    properties: {
      componentVersion: '2.2',
      activityType: 'XmlValidator',
      cmdVariantUri: FLOWSTEP('XmlValidator', '2.2.3')
    }
  },

  // ── Calls (serviceTask) ───────────────────────────────
  REQUEST_REPLY: {
    stepType: 'serviceTask',
    width: 100,
    properties: {
      componentVersion: '1.0',
      activityType: 'ExternalCall',
      cmdVariantUri: FLOWSTEP('ExternalCall', '1.0.4')
    }
  },

  SEND: {
    stepType: 'serviceTask',
    width: 100,
    properties: {
      componentVersion: '1.0',
      activityType: 'Send',
      cmdVariantUri: FLOWSTEP('Send', '1.0.4')
    }
  },

  CONTENT_ENRICHER: {
    stepType: 'serviceTask',
    width: 100,
    thin: true,
    properties: {
      componentVersion: '1.2',
      activityType: 'contentEnricherWithLookup',
      cmdVariantUri: FLOWSTEP('contentEnricherWithLookup', '1.2.0')
    }
  },

  POLL_ENRICH: {
    stepType: 'serviceTask',
    width: 100,
    properties: {
      componentVersion: '1.1',
      activityType: 'PollEnrich',
      cmdVariantUri: FLOWSTEP('PollEnrich', '1.1.0')
    }
  },

  // ── Gateways ──────────────────────────────────────────
  ROUTER: {
    stepType: 'exclusiveGateway',
    width: 40,
    properties: {
      componentVersion: '1.1',
      activityType: 'ExclusiveGateway',
      cmdVariantUri: FLOWSTEP('ExclusiveGateway', '1.1.2'),
      throwException: 'false'
    }
  },

  MULTICAST_PARALLEL: {
    stepType: 'parallelGateway',
    width: 40,
    properties: {
      componentVersion: '1.1',
      activityType: 'Multicast',
      subActivityType: 'parallel',
      cmdVariantUri: FLOWSTEP('Multicast', '1.1.1')
    }
  },

  MULTICAST_SEQUENTIAL: {
    stepType: 'parallelGateway',
    width: 40,
    properties: {
      componentVersion: '1.1',
      activityType: 'SequentialMulticast',
      subActivityType: 'parallel',
      cmdVariantUri: FLOWSTEP('SequentialMulticast', '1.1.0')
    }
  },

  JOIN: {
    stepType: 'parallelGateway',
    width: 40,
    properties: {
      componentVersion: '1.0',
      activityType: 'Join',
      subActivityType: 'parallel',
      cmdVariantUri: FLOWSTEP('Join', '1.0.0')
    }
  }
};

// Conditional branching off a Router is not generated yet. When it is, the
// branch is a <bpmn2:sequenceFlow> carrying expressionType (NonXML for
// ${property.X} = 'v', XML for a raw XPath), componentVersion 1.0 and
// cmdVariantUri ctype::FlowstepVariant/cname::GatewayRoute/version::1.0.0,
// plus a sibling <bpmn2:conditionExpression> after extensionElements. The
// branch that omits that element is the default route.

// Legacy/loose names accepted from the spec builder.
export const STEP_ALIASES = {
  DATA_STORE: 'DATA_STORE_WRITE',
  DATA_STORE_PUT: 'DATA_STORE_WRITE',
  SPLITTER: 'GENERAL_SPLITTER',
  MULTICAST: 'MULTICAST_PARALLEL',
  SCRIPT: 'GROOVY_SCRIPT',
  ENCODER: 'BASE64_ENCODER',
  DECODER: 'BASE64_DECODER'
};
