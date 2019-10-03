const fs = require('fs');
const readLine = require('readline');
const moment = require('moment');
const { containerIsoCode, equipmentStatus, codeListDangerousGoods } = require('./dictionary');

const lineReader = readLine.createInterface({
  // input: fs.createReadStream('DEMO_BAPLIE_22.edi'),
  // input: fs.createReadStream('demo_v22.edi'),
  input: fs.createReadStream('demo_v15.edi'),
});

const INTERCHANGE_HEADER = 'UNB';
const MESSAGE_HEADER = 'UNH';
const BEGINNING_OF_MESSAGE = 'BGM';
const DATE_TIME_PERIOD = 'DTM';
const DETAILS_OF_TRANSPORT = 'TDT';
const PLACE_LOCATION_IDENTIFICATION = 'LOC';
const GOODS_ITEM_DETAILS = 'GID';
const NATURE_OF_CARGO = 'GDS';
const FREE_TEXT = 'FTX';
const MEASUREMENT = 'MEA';
const DIMENSIONS = 'DIM';
const TEMPERATURE = 'TMP';
const RANGE_DETAILS = 'RNG';
const REFERENCE = 'RFF';
const EQUIPMENT_DETAILS = 'EQD';
const EQUIPMENT_ATTACHED = 'EQA';
const NAME_AND_ADDRESS = 'NAD';
const DANGEROUS_GOODS = 'DGS';

const SMDG_VERSION_15 = 'SMDG15';
const SMDG_VERSION_22 = 'SMDG22';

const containerIsoCodeJson = containerIsoCode;
const equipmentStatusJson = equipmentStatus;
const codeListDangerousGoodsJson = codeListDangerousGoods;

let data = {};

let parseEdiStatus = {
  status: true,
  message: '',
};

// Group 1 -> Group 2 (Group 3 -> Group 4)
// Group 1: TDT - LOC - DTM - RFF - FTX
let group1 = false;
// Group 2: LOC - GID - GDS - FTX - MEA - DIM - TMP - RNG - LOC - RFF - grp3 - grp4
let group2 = false;
// Group 3: EQD - EQA - NAD
let group3 = false;
// Group 4:
let group4 = false;

let containerId = 0;

let hasFurtherDetails = false;

let equipmentAttached = [];

let associationAssignedCode = '';

let shouldAddBreakLine = false;

lineReader
  .on('line', line => {
    const checkLines = line.split("'");
    if (checkLines.length > 2 && checkLines[1].trim()) {
      shouldAddBreakLine = true;
    }

    if (shouldAddBreakLine) {
      checkLines.map(newLine => {
        processDataLine(newLine);
      });
    } else {
      processDataLine(line);
    }

    if (!parseEdiStatus.status) {
      rl.close();
    }
  })
  .on('close', () => {
    data.totalContainers = data.containers.length;
    console.log('parse completed with total containers: ', JSON.stringify(data.totalContainers));
    console.log('parseEdiStatus: ', JSON.stringify(parseEdiStatus));
    fs.writeFile('ediParsed.json', JSON.stringify(data), err => {
      // In case of a error throw err.
      if (err) throw err;
    });
  });

const processDataLine = line => {
  processInterchangeHeader(line);

  processMessageHeader(line);

  processBeginningOfMessage(line);

  processDateTimePeriod(line);

  processDetailsOfTransport(line);

  processContainers(line);
};

const processInterchangeHeader = line => {
  if (line.includes(INTERCHANGE_HEADER)) {
    const regex = new RegExp(/(UNOA:)(\d)(\W*)(\w*)(\W*)(\w*)(\W*)(\d*):(\d*)/);
    // Syntax Version Number
    try {
      const ediVersion = line.match(regex)[2];
      const senderId = line.match(regex)[4];
      const recipientId = line.match(regex)[6];
      const dateOfPreparation = line.match(regex)[8];
      const timeOfPreparation = line.match(regex)[9];
      const year = dateOfPreparation.substring(0, 2);
      const month = dateOfPreparation.substring(2, 4);
      const day = dateOfPreparation.substring(4, 6);
      const hour = timeOfPreparation.substring(0, 2);
      const minute = timeOfPreparation.substring(2, 4);
      const preparationAt = moment(`20${year}-${month}-${day} ${hour}:${minute}`).format('YYYYMMDDHHMMSS');
      data.interchangeHeader = {
        version: ediVersion,
        senderId,
        recipientId,
        preparationAt,
        data: line,
      };
    } catch (error) {
      parseEdiStatus.status = false;
      parseEdiStatus.message = 'Can not convert InterchangeHeader. Line: ' + line;
    }
  }
};

const processMessageHeader = line => {
  if (line.includes(MESSAGE_HEADER)) {
    const regex = new RegExp(/SMDG\d+/);
    // This will enable the recipient of the message to translate the message
    // correctly, even if older versions are still in use.
    try {
      const result = line.match(regex);
      if (result) {
        associationAssignedCode = result[0];
      } else {
        associationAssignedCode = SMDG_VERSION_15;
      }
      data.messageHeader = {
        associationAssignedCode: associationAssignedCode,
        data: line,
      };
    } catch (error) {
      parseEdiStatus.status = false;
      parseEdiStatus.message = 'Can not convert MessageHeader. Line: ' + line;
    }
  }
};

const processBeginningOfMessage = line => {
  if (line.includes(BEGINNING_OF_MESSAGE)) {
    data.beginningOfMessage = {
      data: line,
    };
  }
};

const processDateTimePeriod = line => {
  if (line.includes(DATE_TIME_PERIOD)) {
    try {
      const regex = new RegExp(/(\d*):(\d*):?(\d*)/);
      // "178" = actual date/time of arrival at senders port
      // "132" = estimated date or date/time of arrival at the next port of call
      // "133" = estimated date or date/time of departure at senders port
      // "136" = actual date/time of departure at senders port
      // "137" = Document/Message Date/Time
      const code = line.match(regex)[1];
      const dateTime = line.match(regex)[2];
      const dateTimeCode = line.match(regex)[3];
      let dateTimeFormat = '';
      switch (dateTimeCode) {
        case '101':
          dateTimeFormat = 'YYMMDD';
          break;
        case '201':
          dateTimeFormat = 'YYMMDDHHMM';
          break;
        case '301':
          // ("ZZZ" = Time zone, e.g. "GMT" or other)
          dateTimeFormat = 'YYMMDDHHMMZZZ';
          break;
        default:
          dateTimeFormat = 'YYYYMMDDHHMMSS';
          break;
      }

      switch (code) {
        case '178':
          data.detailsOfTransport.senderPort.time = {
            code,
            arrivalTime: dateTime,
            dateTimeFormat,
            data: line,
          };
          group1 = false;
          break;
        case '132':
          data.detailsOfTransport.locNextPortCall.time = {
            code,
            estimatedArrivalTime: dateTime,
            dateTimeFormat,
            data: line,
          };
          group1 = false;
          break;
        case '133':
          data.detailsOfTransport.locDeparture.time = {
            code,
            estimatedDepartureTime: dateTime,
            dateTimeFormat,
            data: line,
          };
          group1 = false;
          break;
        case '136':
          data.detailsOfTransport.locDeparture.time = {
            code,
            departureTime: dateTime,
            dateTimeFormat,
            data: line,
          };
          break;
        case '137':
          data.dateTimePeriod = {
            code,
            dateTime,
            dateTimeFormat,
            data: line,
          };
          break;
        default:
          // console.log('processDateTimePeriod Need to consider: ', line);
          break;
      }
    } catch (error) {
      parseEdiStatus.status = false;
      parseEdiStatus.message = 'Can not convert DateTimePeriod. Line: ' + line;
    }
  }
};

const processLocation = line => {
  try {
    if (line.includes(PLACE_LOCATION_IDENTIFICATION)) {
      let regex;

      let locationQualifier = '';
      let locationId = '';
      let codeListQualifier = '';
      let codeListResponsibleAgency = '';

      let placeOfDeparture = '';
      let nextPortOfCall = '';

      if (associationAssignedCode === SMDG_VERSION_22) {
        regex = new RegExp(/(LOC)(\W)(\d*)(\W)(\w*):?(\d*)?:?(\d*)?/);

        // "139" = Port.
        codeListQualifier = line.match(regex)[6];

        // "112" = US, US Census Bureau, Schedule D for U S locations, Schedule K for foreign port locations.
        // "6" = UN/ECE - United Nations - Economic Commission for Europe. (UN-Locodes).
        codeListResponsibleAgency = line.match(regex)[7];
      }

      if (associationAssignedCode === SMDG_VERSION_15) {
        regex = new RegExp(/(LOC)(\W)(\d*)(\W)(\w*):?:?(\w*)?/);
        codeListResponsibleAgency = line.match(regex)[6];
      }

      locationQualifier = line.match(regex)[3];
      locationId = line.match(regex)[5];

      switch (locationQualifier) {
        case '5': // "5" = Place of Departure
          placeOfDeparture = locationId;
          break;
        case '61': // "61" = Next port of call
          nextPortOfCall = locationId;
          break;
        case '147': // "147" = Stowage Cell
          group2 = true;
          let bay = '000';
          let row = '00';
          let tier = '00';
          let deck = '00';
          // 1. ISO-format
          // 2. Ro/Ro-format
          // 3. Other non-ISO-format (to be agreed between partners)
          // * ISO-format:
          //  Bay/Row/Tier (BBBRRTT). If Bay number is less than 3
          //  characters it must be filled with leading zeroes, e.g. "0340210".
          // * Ro/Ro-format:
          //  Deck/Bay/Row/Tier (DDBBBRRTT).
          const containerLocation = locationId;

          const container = {};
          containerId++;
          container.id = containerId;

          switch (codeListResponsibleAgency) {
            case '5': // (ISO-format)
              const bayRowTierRegex = new RegExp(/(\d{3})(\d{2})(\d{2})/);
              bay = containerLocation.match(bayRowTierRegex)[1];
              row = containerLocation.match(bayRowTierRegex)[2];
              tier = containerLocation.match(bayRowTierRegex)[3];
              container.bay = bay;
              container.row = row;
              container.tier = tier;
              data.containers.push(container);
              break;
            case '87': // (Ro/Ro-format, assigned by the Carrier)
              const deckBayRowTierRegex = new RegExp(/(\d{2})(\d{3})(\d{2})(\d{2})/);
              deck = containerLocation.match(deckBayRowTierRegex)[1];
              bay = containerLocation.match(deckBayRowTierRegex)[2];
              row = containerLocation.match(deckBayRowTierRegex)[3];
              tier = containerLocation.match(deckBayRowTierRegex)[4];
              container.deck = deck;
              container.bay = bay;
              container.row = row;
              container.tier = tier;
              data.containers.push(container);
              break;
            case 'ZZZ': // (non-ISO-format, mutually defined)
              break;
            default:
              // console.log('processLocation Need to consider: ', line);
              break;
          }
          break;
        default:
          break;
      }
      if (group1) {
        if (!data.detailsOfTransport.senderPort) {
          data.detailsOfTransport.senderPort = {};
        }
        if (!data.detailsOfTransport.locDeparture) {
          data.detailsOfTransport.locDeparture = {};
        }
        if (!data.detailsOfTransport.locNextPortCall) {
          data.detailsOfTransport.locNextPortCall = {};
        }
      }
      if (placeOfDeparture) {
        data.detailsOfTransport.locDeparture = {
          locationQualifier,
          placeOfDeparture,
          codeListQualifier,
          codeListResponsibleAgency,
          data: line,
        };
      }

      if (nextPortOfCall) {
        data.detailsOfTransport.locNextPortCall = {
          locationQualifier,
          nextPortOfCall,
          codeListQualifier,
          codeListResponsibleAgency,
          data: line,
        };
      }
    }
  } catch (error) {
    console.log('TCL: ConvertEdiToJson -> privateprocessLocation -> error', error);
    parseEdiStatus.status = false;
    parseEdiStatus.message = 'Can not convert Location. Line: ' + line;
  }
};

const processDetailsOfTransport = line => {
  const lineToMatch = line.split('+')[0];
  if (lineToMatch === DETAILS_OF_TRANSPORT) {
    try {
      group1 = true;

      let regex;
      let carrierIdentificationCodeOrName = '';
      let codeListQualifier1 = '';
      let codeListResponsibleAgency1 = '';
      let transportId = '';
      let codeListQualifier2 = '';
      let codeListResponsibleAgency2 = '';
      let vesselIdOrName = '';

      // Code "20" (Main Carriage)
      const transportStateQualifier = line.match(regex)[3];

      // Discharge voyage number as assigned by the Operating Carrier or his agent.
      // The trade route could be included in this voyage number, if required.
      const conveyanceReferenceNumber = line.match(regex)[5];

      if (associationAssignedCode === SMDG_VERSION_22) {
        regex = new RegExp(/(TDT)(\W)(\d*)(\W)(\w*)(\W*)([\w\s]*):(\d*):(\d*)(\W*)(\w*):(\d*):(\w*):((\w|\W[^'])*)/);
        carrierIdentificationCodeOrName = line.match(regex)[7];

        // Code List Qualifier: Code "172" (Carrier Code)
        codeListQualifier1 = line.match(regex)[8];

        // "20" = BIC (Bureau International des Containers)
        // "166" = US National Motor Freight Classification Association (SCAC)
        // "ZZZ" = Mutually defined.
        codeListResponsibleAgency1 = line.match(regex)[9];

        // Id of Means of Transport Identification. Is one of following:
        // 1. Lloyd’s Code (IMO number)
        // 2. Call Sign
        // 3. Mutually agreed vessel code
        transportId = line.match(regex)[11];

        // Code List Qualifier: Allowed qualifiers:
        // "103" = Call Sign Directory
        // "146" = Means of Transport Identification (Lloyd's Code or IMO number)
        // "ZZZ" = Mutually defined or IMO number
        codeListQualifier2 = line.match(regex)[12];

        // "11" = Lloyd's register of shipping. Only to be used when Lloyd's Code is used for vessel/barge identification
        // "ZZZ" = Mutually defined. To be used in all other cases.
        codeListResponsibleAgency2 = line.match(regex)[13];

        // Id. of means of transport: Vessel name, if required
        vesselIdOrName = line.match(regex)[14];
      }

      if (associationAssignedCode === SMDG_VERSION_15) {
        regex = new RegExp(/(TDT)(\W)(\d*)(\W)(\w*)(\W*)(\w*):(\d*):?:?([\w\s-_]*)?:?(\w*)(\W*)(\w*):(\d*):(\d*)/);

        carrierIdentificationCodeOrName = line.match(regex)[12];

        // Code List Qualifier: Code "172" (Carrier Code)
        codeListQualifier1 = line.match(regex)[13];

        // "20" = BIC (Bureau International des Containers)
        // "166" = US National Motor Freight Classification Association (SCAC)
        // "ZZZ" = Mutually defined.
        codeListResponsibleAgency1 = line.match(regex)[14];

        // Id of Means of Transport Identification. Is one of following:
        // 1. Lloyd’s Code (IMO number)
        // 2. Call Sign
        // 3. Mutually agreed vessel code
        transportId = line.match(regex)[7];

        // Code List Qualifier: Allowed qualifiers:
        // "103" = Call Sign Directory
        // "146" = Means of Transport Identification (Lloyd's Code or IMO number)
        // "ZZZ" = Mutually defined or IMO number
        codeListQualifier2 = line.match(regex)[8];

        // Id. of means of transport: Vessel name, if required
        vesselIdOrName = line.match(regex)[9];
      }

      let callSign = '';
      let imo = '';
      let mutuallyAgreedVesselCode = '';
      switch (codeListQualifier2) {
        case '103':
          callSign = transportId;
          break;
        case '146':
          imo = transportId;
          break;
        case 'ZZZ':
          mutuallyAgreedVesselCode = transportId;
          break;
        default:
          // console.log('processDetailsOfTransport Need to consider: ', line);
          break;
      }

      data.detailsOfTransport = {
        transportStateQualifier,
        voyageOrLeg: conveyanceReferenceNumber,
        carrierIdentificationCodeOrName,
        codeListQualifier1,
        codeListResponsibleAgency1,
        callSign,
        imo,
        mutuallyAgreedVesselCode,
        codeListResponsibleAgency2,
        vesselIdOrName,
        data: line,
      };
      data.containers = [];
    } catch (error) {
      parseEdiStatus.status = false;
      console.log('data', data);
      parseEdiStatus.message = 'Can not convert DetailsOfTransport. Line: ' + line;
    }
  }

  if (group1) {
    processLocation(line);

    processDateTimePeriod(line);
  }
};

// LOC - GID - GDS - FTX - MEA - DIM - TMP - RNG - LOC - RFF - grp3 - grp4
const processContainers = line => {
  // grp2
  processLocation(line);
  processGoodItemDetail(line);
  processNatureOfCargo(line);
  if (hasFurtherDetails) {
    processFreeText(line);
  }
  processMeasurement(line);
  processDimensions(line);
  processTemperature(line);
  processRangeDetail(line);
  processLocationForContainer(line);
  processReference(line);

  // grp3
  processEquipmentDetails(line);
  processEquipmentAttached(line);
  processNameAndAddress(line);

  // grp4
  processDangerousGoods(line);
  processFreeTextGroup4(line);
};

const processGoodItemDetail = line => {
  if (line.includes(GOODS_ITEM_DETAILS)) {
    try {
      const regex = new RegExp(/(GID)(\W*)(\d*):(\w*)/);
      // Number of packages. The number of packages of non-containerized cargo.
      // If the cargo is Ro/Ro then the number "1" is used.
      const numberOfPackages = line.match(regex)[3];
      // Type of packages identification. Package type for non-containerized cargo.
      const typeOfPackagesIdentification = line.match(regex)[4];
      const containerInfo = {
        goodsItemDetails: {
          numberOfPackages,
          typeOfPackagesIdentification,
          data: line,
        },
      };
      setCurrentContainer(containerInfo, data);
    } catch (error) {
      parseEdiStatus.status = false;
      parseEdiStatus.message = 'Can not convert GoodItemDetail. Line: ' + line;
    }
  }
};

const processNatureOfCargo = line => {
  try {
    if (line.includes(NATURE_OF_CARGO)) {
      const regex = new RegExp(/(GDS)(\W*)(\w*[^'])/);
      const natureOfCargoCode = line.match(regex)[3];
      switch (natureOfCargoCode) {
        case '01': // Live animal
          break;
        case '06': // Live plant
          break;
        case '09': // Coffee
          break;
        case '10': // Wheat
          break;
        case '12': // Hay
          break;
        case '22': // Malt
          break;
        case '24': // Tobacco
          break;
        case '41': // Hide
          break;
        case '44': // Timber pack
          break;
        case '48': // Waste paper
          break;
        case '49': // News print
          break;
        case '52': // Cotton
          break;
        case '68': // Stone
          break;
        case '72': // Iron scrap
          break;
        default:
          hasFurtherDetails = true;
          // console.log('processNatureOfCargo Need to consider: ', line);
          break;
      }
    }
  } catch (error) {
    parseEdiStatus.status = false;
    parseEdiStatus.message = 'Can not convert GoodItemDetail. Line: ' + line;
  }
};

const processFreeText = line => {
  try {
    if (line.includes(FREE_TEXT)) {
      const regex = new RegExp(/(FTX)(\W*)(\w*)(\W*)(\w*)/);
      const textSubjectQualifier = line.match(regex)[3];
      let freeText = line.match(regex)[5];
      switch (textSubjectQualifier) {
        case 'AAA': // Description of Goods
          break;
        case 'HAN': // Handling Instructions
          break;
        case 'CLR': // Container Loading Remarks
          break;
        case 'SIN': // Special instructions
          break;
        case 'AAI': // General information
          break;
        case 'AAY': // Certification statements
          const anotherRegex = new RegExp(/(FTX)(\W*)(\w*)(\W*)(\w*)(\W*)(\w*)/);
          freeText = line.match(anotherRegex)[7];
          // console.log('Need to consider: ', line);
          break;
        case 'ZZZ': // Mutually defined use
          break;
        default:
          // console.log('processFreeText Need to consider: ', line);
          break;
      }
      const containerInfo = {
        freeText: {
          freeText,
          data: line,
        },
      };
      setCurrentContainer(containerInfo, data);
      hasFurtherDetails = false;
    }
  } catch (error) {
    parseEdiStatus.status = false;
    parseEdiStatus.message = 'Can not convert FreeText. Line: ' + line;
  }
};

const processMeasurement = line => {
  try {
    if (line.includes(MEASUREMENT)) {
      const regex = new RegExp(/(MEA)(\W*)(\w*)(\W*)(\w*):(\d*)/);
      // "WT" (gross weight / gross mass) – not confirmed as verified
      // “VGM” (verified gross mass) – specified weight is verified
      const measurementApplicationQualifier = line.match(regex)[3];
      let isGrossWeightOrMassVerified = false;
      if (measurementApplicationQualifier === 'WT') {
        isGrossWeightOrMassVerified = false;
      }
      if (measurementApplicationQualifier === 'VGM') {
        isGrossWeightOrMassVerified = true;
      }
      // "KGM" = kilogram = preferred
      // "LBR" = pounds
      const measureUnitQualifier = line.match(regex)[5];
      const measureUnitValue = line.match(regex)[6];
      const containerInfo = {
        measurement: {
          isGrossWeightOrMassVerified,
          measureUnitQualifier,
          measureUnitValue,
          data: line,
        },
      };
      setCurrentContainer(containerInfo, data);
    }
  } catch (error) {
    parseEdiStatus.status = false;
    parseEdiStatus.message = 'Can not convert Measurement. Line: ' + line;
  }
};

const processDimensions = line => {
  try {
    if (line.includes(DIMENSIONS)) {
      const regex = new RegExp(/(DIM)(\W*)(\d*)(\W*)(\w*):(\d*):?(\d*):?(\d*)/);
      // * Dimension Qualifier: Allowed qualifiers are:
      // Code "1" = Gross dimensions (break-bulk)
      // Code "5" = Off-standard dims. (over-length front)
      // Code "6" = Off-standard dims. (over-length back)
      // Code "7" = Off-standard dims. (over-width right)
      // Code "8" = Off-standard dims. (over-width left)
      // Code "9" = Off-standard dims. (over-height)
      // Code "10" = external equipment dimensions (Non-ISO equipment)
      // * Basically allowed qualifier "1" for break-bulk cargo and from "5" to "9" for odd-sized-cargo.
      // * However allowed from "5" to "9" for break-bulk cargo as additional information, if required.
      const dimensionQualifier = line.match(regex)[3];
      const measureUnitQualifier = line.match(regex)[5];
      const length = line.match(regex)[6];
      const width = line.match(regex)[7];
      const height = line.match(regex)[8];
      let containerInfo = {};
      switch (dimensionQualifier) {
        case '1': // Code "1" = Gross dimensions (break-bulk)
          containerInfo = {
            dimensionBreakBulk: {
              dimensionQualifier,
              measureUnitQualifier,
              length,
              width,
              height,
              data: line,
            },
          };
          break;
        case '5': // Code "5" = Off-standard dims. (over-length front)
          containerInfo = {
            dimensionOverLengthFront: {
              dimensionQualifier,
              measureUnitQualifier,
              length,
              width,
              height,
              data: line,
            },
          };
          break;
        case '6': // Code "6" = Off-standard dims. (over-length back)
          containerInfo = {
            dimensionOverLengthBack: {
              dimensionQualifier,
              measureUnitQualifier,
              length,
              width,
              height,
              data: line,
            },
          };
          break;
        case '7': // Code "7" = Off-standard dims. (over-width right)
          containerInfo = {
            dimensionOverWidthRight: {
              dimensionQualifier,
              measureUnitQualifier,
              length,
              width,
              height,
              data: line,
            },
          };
          break;
        case '8': // Code "8" = Off-standard dims. (over-width left)
          containerInfo = {
            dimensionOverWidthLeft: {
              dimensionQualifier,
              measureUnitQualifier,
              length,
              width,
              height,
              data: line,
            },
          };
          break;
        case '9': // Code "9" = Off-standard dims. (over-height)
          containerInfo = {
            dimensionOverHeight: {
              dimensionQualifier,
              measureUnitQualifier,
              length,
              width,
              height,
              data: line,
            },
          };
          break;
        case '10': // Code "10" = external equipment dimensions (Non-ISO equipment)
          containerInfo = {
            dimensionNonIso: {
              dimensionQualifier,
              measureUnitQualifier,
              length,
              width,
              height,
              data: line,
            },
          };
          break;
        default:
          // console.log('processDimension Need to consider: ', line);
          break;
      }
      setCurrentContainer(containerInfo, data);
    }
  } catch (error) {
    parseEdiStatus.status = false;
    parseEdiStatus.message = 'Can not convert Dimensions. Line: ' + line;
  }
};

const processTemperature = line => {
  try {
    if (line.includes(TEMPERATURE)) {
      const regex = new RegExp(/(TMP)(\W*)(\d*)(\W)([-]?[0-9]*[.]?[0-9]*):(\w*)/);
      const temperatureQualifier = line.match(regex)[3];
      const temperatureValue = line.match(regex)[5];
      // * Measure Unit Qualifier: Allowed qualifiers:
      // "CEL" = degrees Celsius = Preferred.
      // "FAH" = degrees Fahrenheit
      const measureUnitQualifier = line.match(regex)[6];
      const containerInfo = {
        temperature: {
          temperatureQualifier,
          temperatureValue,
          measureUnitQualifier,
          data: line,
        },
      };
      setCurrentContainer(containerInfo, data);
    }
  } catch (error) {
    parseEdiStatus.status = false;
    parseEdiStatus.message = 'Can not convert Temperature. Line: ' + line;
  }
};

const processRangeDetail = line => {
  try {
    if (line.includes(RANGE_DETAILS)) {
      const regex = new RegExp(/(RNG)(\W*)(\d*)(\W*)(\w*):([-]?[0-9]*[.]?[0-9]*):([-]?[0-9]*[.]?[0-9]*)/);
      const rangeTypeQualifier = line.match(regex)[3];
      // * Measure Unit Qualifier: Allowed qualifiers:
      // "CEL" = degrees Celsius = Preferred.
      // "FAH" = degrees Fahrenheit
      const measureUnitQualifier = line.match(regex)[5];
      const minRange = line.match(regex)[6];
      const maxRange = line.match(regex)[7];
      const containerInfo = {
        rangeDetail: {
          rangeTypeQualifier,
          measureUnitQualifier,
          minRange,
          maxRange,
          data: line,
        },
      };
      setCurrentContainer(containerInfo, data);
    }
  } catch (error) {
    parseEdiStatus.status = false;
    parseEdiStatus.message = 'Can not convert RangeDetail. Line: ' + line;
  }
};

const processLocationForContainer = line => {
  try {
    if (line.includes(PLACE_LOCATION_IDENTIFICATION)) {
      const regex = new RegExp(/(LOC)(\W)(\d*)(\W)(\w*):?(\d*)?:?(\d*)?(\W)?(\w*)?:?(\w*)?:?(\w*)?/);

      const placeLocationQualifier = line.match(regex)[3];
      const placeLocationIdentification = line.match(regex)[5];
      const codeListQualifier = line.match(regex)[6];

      // Code list responsible agency, coded. Allowed codes:
      // "112" = US, US Census Bureau, Schedule D for U S locations, Schedule K for foreign port locations.
      // "6" = UN/ECE - United Nations - Economic Commission for Europe. (UN-Locodes).
      // "ZZZ" = Optional ports.
      const codeListResponsibleAgency = line.match(regex)[7];

      // Related place/location one identification.
      // The name code of the Container Terminal in the port of discharge or the port of loading.
      // Terminal codes to be used as defined in SMDG’s Master Terminal Facilities code list.
      const relatedPlaceLocationIdentification = line.match(regex)[9];

      // "TER" = TERMINALS (leading 3 characters due to limited size).
      const codeListQualifier2 = line.match(regex)[10];

      // “306” = SMDG (code 306 is defined in D.02B and later)
      const codeListResponsibleAgency2 = line.match(regex)[11];

      const containerInfo = {};
      switch (placeLocationQualifier) {
        case '9': // Place/Port of Loading
          containerInfo.portOfLoading = {
            locationCode: placeLocationIdentification,
            codeListQualifier,
            codeListResponsibleAgency,
            relatedPlaceLocationIdentification,
            codeListQualifier2,
            codeListResponsibleAgency2,
            data: line,
          };
          break;
        case '11': // Place/Port of discharge
          containerInfo.portOfDischarge = {
            locationCode: placeLocationIdentification,
            codeListQualifier,
            codeListResponsibleAgency,
            relatedPlaceLocationIdentification,
            codeListQualifier2,
            codeListResponsibleAgency2,
            data: line,
          };
          break;
        case '13': // Transshipment port/Place of transshipment
          containerInfo.portOfTransShipment = {
            locationCode: placeLocationIdentification,
            codeListQualifier,
            codeListResponsibleAgency,
            relatedPlaceLocationIdentification,
            codeListQualifier2,
            codeListResponsibleAgency2,
            data: line,
          };
          break;
        case '64': // 1st optional port of discharge
          containerInfo.portOfDischarge1 = {
            locationCode: placeLocationIdentification,
            codeListQualifier,
            codeListResponsibleAgency,
            relatedPlaceLocationIdentification,
            codeListQualifier2,
            codeListResponsibleAgency2,
            data: line,
          };
          break;
        case '68': // 2nd optional port of discharge
          containerInfo.portOfDischarge2 = {
            locationCode: placeLocationIdentification,
            codeListQualifier,
            codeListResponsibleAgency,
            relatedPlaceLocationIdentification,
            codeListQualifier2,
            codeListResponsibleAgency2,
            data: line,
          };
          break;
        case '70': // 3rd optional port of discharge
          containerInfo.portOfDischarge3 = {
            locationCode: placeLocationIdentification,
            codeListQualifier,
            codeListResponsibleAgency,
            relatedPlaceLocationIdentification,
            codeListQualifier2,
            codeListResponsibleAgency2,
            data: line,
          };
          break;
        case '76': // Original port of loading
          containerInfo.originalPortOfLoading = {
            locationCode: placeLocationIdentification,
            codeListQualifier,
            codeListResponsibleAgency,
            relatedPlaceLocationIdentification,
            codeListQualifier2,
            codeListResponsibleAgency2,
            data: line,
          };
          break;
        case '83': // Place of delivery (to be used as final destination or double stack train destination).
          containerInfo.placeOfDelivery = {
            locationCode: placeLocationIdentification,
            codeListQualifier,
            codeListResponsibleAgency,
            relatedPlaceLocationIdentification,
            codeListQualifier2,
            codeListResponsibleAgency2,
            data: line,
          };
          break;
        case '97': // Optional place/port of discharge. To be used if actual port of discharge is undefined, i.e. "XXOPT".
          containerInfo.portOfDischargeUnknown = {
            locationCode: placeLocationIdentification,
            codeListQualifier,
            codeListResponsibleAgency,
            relatedPlaceLocationIdentification,
            codeListQualifier2,
            codeListResponsibleAgency2,
            data: line,
          };
          break;
        case '152': // Next port of discharge
          containerInfo.nextPortOfDischarge = {
            locationCode: placeLocationIdentification,
            codeListQualifier,
            codeListResponsibleAgency,
            relatedPlaceLocationIdentification,
            codeListQualifier2,
            codeListResponsibleAgency2,
            data: line,
          };
          break;
        default:
          // console.log('processLocationForContainer Need to consider: ', line);
          break;
      }
      setCurrentContainer(containerInfo, data);
    }
  } catch (error) {
    parseEdiStatus.status = false;
    parseEdiStatus.message = 'Can not convert LocationForContainer. Line: ' + line;
  }
};

const processReference = line => {
  try {
    if (line.includes(REFERENCE)) {
      const regex = new RegExp(/(RFF)(\W*)(\w*):?(\d*)/);
      // Reference Qualifier: Allowed qualifiers:
      // "BM" = B/L-number. "BN" = Booking reference number.
      // "ET" = Excess Transportation Number to be used for leading Stowage position, in case of Break-bulk or odd-sized-cargo.
      // "ZZZ" = Mutually defined.
      const referenceQualifier = line.match(regex)[3];
      // Reference Number: For Qualifiers "BM", "BN" or "ZZZ": Dummy value "1" or the actual Bill of Lading number resp.
      // Booking Reference number, as agreed.
      // For Qualifier "ET": leading stowage location, containing relevant data for this consignment.
      const referenceNumber = line.match(regex)[4];
      const containerInfo = {
        reference: {
          referenceQualifier,
          referenceNumber,
          data: line,
        },
      };
      setCurrentContainer(containerInfo, data);
    }
  } catch (error) {
    console.log('TCL: ConvertEdiToJson -> privateprocessReference -> error: ', error);
    parseEdiStatus.status = false;
    parseEdiStatus.message = 'Can not convert Reference. Line: ' + line;
  }
};

const processEquipmentDetails = line => {
  try {
    if (line.includes(EQUIPMENT_DETAILS)) {
      group3 = true;
      const regex = new RegExp(/(EQD)(\W)(\w*)(\W)([\w\s]*)?(\W)?(\w*)?(\W)?(\W)?(\d*)?(\W)?(\d*)?/);

      // * Equipment Qualifier: Allowed qualifiers:
      // "CN" = Container
      // "BB" = Break-bulk
      // "TE" = Trailer
      // "ZZZ" = Ro/Ro or otherwise
      const equipmentQualifier = line.match(regex)[3];

      // * Equipment Identification Number:
      // 1. The container number:
      //   Format: One continuous string with the identification, prefix
      //   and number. Examples: SCXU 2387653 must be transmitted as
      //   "SCXU2387653", EU 876 must be transmitted as "EU876". The
      //   number will be treated as a character string. E.g.
      //   alphanumeric check-digits can be transmitted here. If this
      //   segment is used the unique equipment identification number
      //   must always be transmitted, although this element is not
      //   mandatory!
      // 2. Break-bulk: The break-bulk reference number. The assigned
      //   break-bulk reference numbers must be agreed between partners.
      // 3. Otherwise (Ro/Ro): The equipment identification number.
      const equipmentIdentificationNumber = line.match(regex)[5];

      // Equipment Size and Type Identification: ISO size-type code of 4 digits (ISO 6346).
      // Leave blank in case of break-bulk.
      // For unknown ISO size/type codes the following codes can be agreed between partners:
      // TODO: also call ISO CODE
      const equipmentSizeAndTypeIdentification = line.match(regex)[7];
      let noInformation = false;
      let containerDetail = {};
      switch (equipmentSizeAndTypeIdentification) {
        // case 2099: // "2099" = 20ft 8'0", rest unknown
        //   containerDetail = 'rest unknown';
        //   break;
        // case 2299: // "2299" = 20ft 8'6", rest unknown
        //   containerDetail = 'rest unknown';
        //   break;
        // case 2999: // "2999" = Length = 20ft, rest unknown
        //   containerDetail = 'rest unknown';
        //   break;
        // case 4099: // "4099" = 40ft 8'0", rest unknown
        //   containerDetail = 'rest unknown';
        //   break;
        // case 4299: // "4299" = 40ft 8'6", rest unknown
        //   containerDetail = 'rest unknown';
        //   break;
        // case 4999: // "4999" = Length = 40ft, rest unknown
        //   containerDetail = 'rest unknown';
        //   break;
        case 9999: // "9999" = No information at all.
          containerDetail = prop(containerIsoCodeJson, equipmentSizeAndTypeIdentification);
          noInformation = true;
          break;
        default:
          // Other codes to be agreed between partners.
          containerDetail = prop(containerIsoCodeJson, equipmentSizeAndTypeIdentification);
          if (!containerDetail) {
            console.log('Container ISO type unknown: ', line);
            containerDetail = {
              containerDetail: 'Unknown',
              containerTypeCode: 'unknown',
              containerColor: '#9E9E9E',
              containerGroup: equipmentSizeAndTypeIdentification,
              containerLength: 0,
              containerHeight: 0,
            };
          }
          break;
      }

      const equipmentStatusCode = line.match(regex)[10];
      let equipmentStatus = undefined;
      if (equipmentStatusCode) {
        equipmentStatus = prop(equipmentStatusJson, equipmentStatusCode);
      }

      // Full/Empty Indicator,
      // "5" = Full
      // "4" = Empty
      const fullEmptyIndicator = line.match(regex)[12];
      const isFull = fullEmptyIndicator === '5' ? true : false;

      const containerInfo = {
        equipment: {
          equipmentQualifier,
          equipmentIdentificationNumber,
          containerDetail,
          noInformation,
          equipmentStatus,
          isFull,
          data: line,
        },
      };
      setCurrentContainer(containerInfo, data);
    }
  } catch (error) {
    console.log('TCL: error', error);
    parseEdiStatus.status = false;
    parseEdiStatus.message = 'Can not convert EquipmentDetails. Line: ' + line;
  }
};

const processEquipmentAttached = line => {
  try {
    if (line.includes(EQUIPMENT_ATTACHED)) {
      let regex = new RegExp(/(EQA)(\W*)(\w*)(\W*)([\w\s]*)/);
      // * Equipment Qualifier: Allowed qualifiers:
      // "RG" = Reefer Generator
      // "CN" = Container
      // "CH" = Chassis
      const equipmentQualifier = line.match(regex)[3];
      const equipmentIdentificationNumber = line.match(regex)[5];
      equipmentAttached.push({
        equipmentQualifier,
        equipmentIdentificationNumber,
        data: line,
      });
      const containerInfo = {
        equipmentAttached: equipmentAttached,
      };
      setCurrentContainer(containerInfo, data);
    }
  } catch (error) {
    parseEdiStatus.status = false;
    parseEdiStatus.message = 'Can not convert EquipmentAttached. Line: ' + line;
  }
};

const processNameAndAddress = line => {
  try {
    if (line.includes(NAME_AND_ADDRESS)) {
      const regex = new RegExp(/(NAD)(\W)(\w*)(\W)([\w\s]*):(\d*):(\d*)/);
      const partyQualifier = line.match(regex)[3];
      const partyId = line.match(regex)[5];
      const costListQualifier = line.match(regex)[6];

      // "20" = BIC (Bureau International des Containeurs)
      // "166" = US National Motor Freight Classification Association (SCAC)
      // "ZZZ" = Mutually agreed.
      const costListResponsibleAgency = line.match(regex)[7];
      const containerInfo = {
        nameAndAddress: {
          partyQualifier,
          carrier: partyId,
          costListQualifier,
          costListResponsibleAgency,
          data: line,
        },
      };
      setCurrentContainer(containerInfo, data);
      // end of group 3
      equipmentAttached = [];
      group3 = false;
    }
  } catch (error) {
    parseEdiStatus.status = false;
    parseEdiStatus.message = 'Can not convert NameAndAddress. Line: ' + line;
  }
};

const processDangerousGoods = line => {
  try {
    if (line.includes(DANGEROUS_GOODS)) {
      const regex = new RegExp(
        /(DGS)(\W)(\w*)(\W)([\d.]*)?:?([\d:]*)?(\W)(\d*)(\W)?([\d-.]*)?:?(\w*)?(\W)?(\d*)?(\W)?([\d.-]*)?(\W)?(\w*)?(\W*)?([\d.]*)?:?([\d.]*)?(\W)?([\w\s]*)?:?([\w\s]*)?:?([\w\s]*)?/,
      );
      const dangerousGoodsRegulationsCode = line.match(regex)[3];
      const hazardCodeIdentification = line.match(regex)[5];
      let riskType = undefined;
      if (hazardCodeIdentification) {
        riskType = prop(codeListDangerousGoodsJson, hazardCodeIdentification);
      }
      const hazardSubstanceItemPageNumber = line.match(regex)[6];
      // UNDG Number: UN number of respective dangerous cargo
      const undgNumber = line.match(regex)[8];

      // * Shipment Flashpoint: the actual flashpoint in degrees Celsius or Fahrenheit.
      // For inserting temperatures below zero or tenth degrees please refer to remarks
      // under TMP-segment respectively to ISO 9735.
      // If different dangerous goods with different flashpoints within one load to be transported,
      // only the lowest flashpoint should be inserted.
      const shipFlashPoint = line.match(regex)[10];

      // * Measure Unit Qualifier: Allowed qualifiers:
      // "CEL" (degrees Celsius) = Preferred
      // "FAH" (degrees Fahrenheit)
      const measureUnitQualifier = line.match(regex)[11];

      const packingGroupCode = line.match(regex)[13];

      const emsNumber = line.match(regex)[15];

      const medicalFirstAidGuideNumber = line.match(regex)[17];

      const hazardCodeIdentificationUpperPart = line.match(regex)[19];

      let riskTypeUpperPart = undefined;
      if (hazardCodeIdentificationUpperPart) {
        riskTypeUpperPart = prop(codeListDangerousGoodsJson, hazardCodeIdentificationUpperPart);
      }

      const substanceIdentificationNumberLowerPart = line.match(regex)[20];

      let riskSubStanceTypeLowerPart = undefined;
      if (substanceIdentificationNumberLowerPart) {
        riskSubStanceTypeLowerPart = prop(codeListDangerousGoodsJson, substanceIdentificationNumberLowerPart);
      }

      const dangerousGoodsLabelMarking1 = line.match(regex)[22];
      const dangerousGoodsLabelMarking2 = line.match(regex)[23];
      const dangerousGoodsLabelMarking3 = line.match(regex)[24];

      const containerInfo = {
        dangerousGoods: {
          dangerousGoodsRegulationsCode,
          hazardCodeIdentification,
          riskType,
          hazardSubstanceItemPageNumber,
          undgNumber,
          shipFlashPoint,
          measureUnitQualifier,
          packingGroupCode,
          emsNumber,
          medicalFirstAidGuideNumber,
          hazardCodeIdentificationUpperPart,
          riskTypeUpperPart,
          substanceIdentificationNumberLowerPart,
          riskSubStanceTypeLowerPart,
          dangerousGoodsLabelMarking1,
          dangerousGoodsLabelMarking2,
          dangerousGoodsLabelMarking3,
          data: line,
        },
      };
      setCurrentContainer(containerInfo, data);
    }
  } catch (error) {
    parseEdiStatus.status = false;
    parseEdiStatus.message = 'Can not convert DangerousGoods. Line: ' + line;
  }
};

const processFreeTextGroup4 = line => {
  try {
    if (line.includes(FREE_TEXT)) {
      const regex = new RegExp(/(FTX)(\W)(\w*)(\W*)?([\w\s]*)?:?([\w\s]*)?:?([\w\s]*)?/);

      const textSubjectQualifier = line.match(regex)[3];
      let textSubjectQualifierDescription = '';
      const freeText = line.match(regex)[5];
      switch (textSubjectQualifier) {
        case 'AAC': // Dangerous goods additional information
          textSubjectQualifierDescription = 'Dangerous goods additional information';
          break;
        case 'AAD': // Dangerous goods, technical name, proper shipping name
          textSubjectQualifierDescription = 'Dangerous goods, technical name, proper shipping name';
          break;
        default:
          // console.log('processFreeText Need to consider: ', line);
          break;
      }
      const freeTextNetWeightInKilos = line.match(regex)[6];
      const freeTextDgReferenceNumber = line.match(regex)[7];
      const containerInfo = {
        freeTextGrp4: {
          freeText,
          textSubjectQualifier,
          textSubjectQualifierDescription,
          freeTextNetWeightInKilos,
          freeTextDgReferenceNumber,
          data: line,
        },
      };
      setCurrentContainer(containerInfo, data);
      // group4 = false;
      group2 = false;
    }
  } catch (error) {
    parseEdiStatus.status = false;
    parseEdiStatus.message = 'Can not convert FreeTextGroup4. Line: ' + line;
  }
};

const setCurrentContainer = containerInfo => {
  if (data.containers) {
    return data.containers.map(container => {
      if (container.id === containerId) {
        const lastState = container.info || {};
        container.info = { ...lastState, ...containerInfo };
        return container;
      }
      return {};
    });
  } else {
    data.containers = [];
  }
};

const prop = (obj, key) => {
  return obj[key];
};
