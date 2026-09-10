export const STEP_LIBRARY = {
  CONTENT_MODIFIER: {
    stepType: 'callActivity',
    width: 100,
    properties: {
      componentVersion: '1.5',
      activityType: 'Enricher',
      cmdVariantUri: 'ctype::FlowstepVariant/cname::Enricher/version::1.5.1'
    }
  },

  CONTENT_ENRICHER: {
    stepType: 'callActivity',
    width: 100,
    properties: {
      componentVersion: '1.5',
      activityType: 'Enricher',
      cmdVariantUri: 'ctype::FlowstepVariant/cname::Enricher/version::1.5.1'
    }
  },

  MESSAGE_MAPPING: {
    stepType: 'callActivity',
    width: 100,
    properties: {
      componentVersion: '1.3',
      activityType: 'Mapping',
      cmdVariantUri: 'ctype::FlowstepVariant/cname::MessageMapping/version::1.3.1',
      mappingType: 'MessageMapping',
      mappingReference: 'static'
    }
  },

  GROOVY_SCRIPT: {
    stepType: 'callActivity',
    width: 100,
    properties: {
      componentVersion: '1.1',
      activityType: 'Script',
      cmdVariantUri: 'ctype::FlowstepVariant/cname::GroovyScript/version::1.1.2',
      subActivityType: 'GroovyScript',
      scriptFunction: 'processData'
    }
  },

  REQUEST_REPLY: {
    stepType: 'serviceTask',
    width: 100,
    properties: {
      componentVersion: '1.0',
      activityType: 'ExternalCall',
      cmdVariantUri: 'ctype::FlowstepVariant/cname::ExternalCall/version::1.0.4'
    }
  },

  CSV_TO_XML: {
    stepType: 'callActivity',
    width: 100,
    properties: {
      componentVersion: '1.0',
      activityType: 'CsvToXmlConverter',
      cmdVariantUri: 'ctype::FlowstepVariant/cname::CsvToXmlConverter/version::1.0'
    }
  },

  XML_TO_CSV: {
    stepType: 'callActivity',
    width: 100,
    properties: {
      componentVersion: '1.0',
      activityType: 'XmlToCsvConverter',
      cmdVariantUri: 'ctype::FlowstepVariant/cname::XmlToCsvConverter/version::1.0'
    }
  },

  ROUTER: {
    stepType: 'callActivity',
    width: 100,
    properties: {
      componentVersion: '1.0',
      activityType: 'Router',
      cmdVariantUri: 'ctype::FlowstepVariant/cname::Router/version::1.0'
    }
  },

  FILTER: {
    stepType: 'callActivity',
    width: 100,
    properties: {
      componentVersion: '1.0',
      activityType: 'Filter',
      cmdVariantUri: 'ctype::FlowstepVariant/cname::Filter/version::1.0'
    }
  },

  SPLITTER: {
    stepType: 'callActivity',
    width: 100,
    properties: {
      componentVersion: '1.0',
      activityType: 'GeneralSplitter',
      cmdVariantUri: 'ctype::FlowstepVariant/cname::GeneralSplitter/version::1.0'
    }
  },

  DATA_STORE: {
    stepType: 'callActivity',
    width: 100,
    properties: {
      componentVersion: '1.7',
      activityType: 'DBstorage',
      cmdVariantUri: 'ctype::FlowstepVariant/cname::put/version::1.7.1',
      operation: 'put',
      storageName: 'Generated_DataStore'
    }
  },

  MAIL_ADAPTER: {
    stepType: 'serviceTask',
    width: 100,
    properties: {
      componentVersion: '1.0',
      activityType: 'ExternalCall',
      cmdVariantUri: 'ctype::FlowstepVariant/cname::ExternalCall/version::1.0.4'
    }
  }
};
