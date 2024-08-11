const axios = require("axios");
const tulind = require("tulind");
const AWS = require("aws-sdk");
AWS.config.update({ region: "us-east-1" });
const dynamodb = new AWS.DynamoDB.DocumentClient();
const cloudwatchlogs = new AWS.CloudWatchLogs();
const cron = require("node-cron");
const moment = require('moment-timezone');

const jKey = "f8484435c52d1960b8f9cda6c01e39c0a6af7518a8f6ead55301131c7cc1a328";
const GET_LIMITS = "https://piconnect.flattrade.in/PiConnectTP/Limits";
const PLACE_ORDER = "https://piconnect.flattrade.in/PiConnectTP/PlaceOrder";
const TP_SERIES = "https://piconnect.flattrade.in/PiConnectTP/TPSeries";
const SEARCH_SCRIPT = "https://piconnect.flattrade.in/PiConnectTP/SearchScrip";
const MODIFY_ORDER = "https://piconnect.flattrade.in/PiConnectTP/ModifyOrder";
const CANCEL_ORDER = "https://piconnect.flattrade.in/PiConnectTP/CancelOrder";
const ORDER_BOOK = "https://piconnect.flattrade.in/PiConnectTP/OrderBook";
const POSITIONS_BOOK =
  "https://piconnect.flattrade.in/PiConnectTP/PositionBook";
  
const baseUrl = 'https://:3000';
const stopJoinsEndpoints = '';
const place_sl_order = '';

const userId = "FT040534";
const password = "Rahul@944";
const actId = "FT040534";
const source = "API";

let successfulOrderId = '';
// store this successfull order id, to modify the order if needed(to trail the stop loss of an existing order)
//this has to be the order id of the sl order placed, not the first directional order (B/S)

const appBaseUrl = 'http://44.195.171.233:3000';
const appPlaceOrder = '/placeOrder';
const appModifyOrder = '/modifyOrder';
const appModifySlOrder = '/modifySlOrder';
const appPlaceSlOrder = '/placeSlOrder';

const months = [
  "JAN",
  "FEB",
  "MAR",
  "APR",
  "MAY",
  "JUN",
  "JUL",
  "AUG",
  "SEP",
  "OCT",
  "NOV",
  "DEC",
];

const Types = {
  Connection: "c",
  OrderUpdate: "o",
  UnsubscribeOrderUpdate: "uo",
  Depth: "d",
  Details: "t"
};

const WebSocketState = {
  CONNECTING: 0,
  OPEN: 1,
  CLOSING: 2,
  CLOSED: 3,
};

const OrderStatus = {

}

const QTY = 1;
const LOT_SIZE = 250;
let gToken = "";
let slOrderId = "";
let hasPosition = false;

// ------------- WEB SOCKET connection

const url = "wss://piconnect.flattrade.in/PiConnectWSTp/";
const WebSocket = require("ws");

const ws = new WebSocket(url);

// ------------- WEB SOCKET connection


// ---------- sqs attributes

const sqs = new AWS.SQS({apiVersion: '2012-11-05'});

// Define the parameters for receiving messages from the queue

const logGroupName = 'ec2i_logs'; // Specify the log group name here
const logStreamName = 'natural_gas_mini_15min';

let utcNow = moment.utc();
let timeNow = null;

// Define the timezone for Indian Standard Time (IST)
let istNow = utcNow.tz('Asia/Kolkata');


const place_order = async (trading_symbol, jKey, direction, qty,is_sl_order = false,price = "0") => {
  console.log("qty in place order -------", qty * LOT_SIZE,price,is_sl_order);

  // I - MIS,, M - NRML
  const jData = {
    uid: "FT040534",
    actid: "FT040534",
    exch: "MCX",
    tsym: trading_symbol,
    qty: String(qty * LOT_SIZE),
    prc: is_sl_order ? price : "0",
    prd: "I",
    trantype: direction > 0 ? "B" : "S",
    prctyp: is_sl_order ? "SL-LMT" : "MKT",
    ret: "DAY",
  };
  
  if(is_sl_order){
    jData['trgprc'] = price;
  }
  
  const query = {
    jKey,
    is_sl_order,
    account: "FT040534"
  }
  const url = `${appBaseUrl}${appPlaceOrder}?${new URLSearchParams(query)}`;
  const resp = await axios.post(url,jData);
  if(resp?.data?.stat?.toLowerCase() == "ok"){
    hasPosition = true;
  }
  console.log("resp here -----",resp['data']);
  
  
  return;
  
  console.log("in place order");
  const response = await axios.post(
    PLACE_ORDER,
    `jData=${JSON.stringify(jData)}&jKey=${jKey}`
  );
  return response;
};

const putLog = async (message) => {
  const params = {
        logGroupName: logGroupName,
        logStreamName: logStreamName,
        logEvents: [
            {
                message: message,
                timestamp: new Date().getTime()
            }
        ]
    };

    cloudwatchlogs.putLogEvents(params, function(err, data) {
        if (err) {
            console.log("Error logging to CloudWatch Logs:", err);
        } else {
            console.log("Logged to CloudWatch Logs successfully:", data);
        }
    });
}

const search_script = async (search_text, jKey) => {
  const jData = {
    uid: "FT040534",
    exch: "MCX",
    stext: search_text,
  };

  console.log("in search script function");
  const response = await axios.post(
    SEARCH_SCRIPT,
    `jData=${JSON.stringify(jData)}&jKey=${jKey}`
  );
  return response;
};

const get_ema = async (close, period) => {
  return new Promise((resolve, reject) => {
    tulind.indicators.ema.indicator([close], [period], (err, result) => {
      if (err) {
        console.log("Error in ema get func");
        console.log(err);
      } else {
        const emaValues = result[0].reverse();
        // console.log("RSI values:", emaValues);
        resolve(emaValues);
      }
    });
  });
};

const get_aroon = async (high, low, period) => {
  return new Promise((resolve, reject) => {
    tulind.indicators.aroon.indicator([high, low], [period], (err, result) => {
      if (err) {
        console.log("Error in ema get func");
        console.log(err);
      } else {
        const aroonDown = result[0];
        const aroonUp = result[1];
        aroonUp.reverse();
        aroonDown.reverse();
        resolve([aroonDown, aroonUp]);
      }
    });
  });
};

const get_rsi = async (close, period) => {
  return new Promise((resolve, reject) => {
    tulind.indicators.rsi.indicator([close], [period], (err, result) => {
      if (err) {
        console.log("Error in rsi get func");
        console.log(err);
      } else {
        const rsiValues = result[0].reverse();
        // console.log("RSI values:", rsiValues);
        resolve(rsiValues);
      }
    });
  });
};

const calculateATR = async (high, low, close, length) => {
  return new Promise((resolve, reject) => {
    tulind.indicators.atr.indicator(
      [high, low, close],
      [length],
      (err, result) => {
        if (err) {
          console.error("Error in ATR calculation");
          console.error(err);
          reject(err);
        } else {
          resolve(result[0]);
        }
      }
    );
  });
};

const getSupertrend = async (high, low, close, atrLength, factor) => {
  const atrResult = await calculateATR(high, low, close, atrLength);
  const atr = atrResult[0];

  let supertrend = [];
  let isUpTrend = true;

  for (let i = 0; i < close.length; i++) {
    const basicUpperBand = close[i] + factor * atr[i];
    const basicLowerBand = close[i] - factor * atr[i];

    if (i === 0) {
      supertrend.push(0);
    } else {
      isUpTrend = close[i - 1] > supertrend[i - 1] ? true : false;
      supertrend.push(isUpTrend ? basicUpperBand : basicLowerBand);
    }
  }

  return supertrend;
};

const get_positions = async (jKey) => {
  const jData = {
    uid: "FT040534",
    actid: "FT040534",
  };
  const response = await axios.post(
    POSITIONS_BOOK,
    `jData=${JSON.stringify(jData)}&jKey=${jKey}`
  );
  return response;
};

const getPrevious9thDay = (date = new Date()) => {
  const previous = new Date(date.getTime());
  previous.setDate(date.getDate() - 15);
  previous.setHours(0);
  previous.setMinutes(0);
  previous.setSeconds(0);
  previous.setMilliseconds(0);

  return previous;
};

const get_next_x_fut = (data, symbol, x) => {
  const date = new Date();
  const curr_month = date.getMonth();
  const regex = new RegExp(
    `^${symbol}[0-9]{2}${months[(curr_month + x) % 12]}[0-9]{2}`
  );
  const filteredArray = data.filter((obj) => regex.test(obj.tsym));
  return filteredArray;
};


const get_time_price_series = async (symbol_token, jKey) => {
  console.log("in get time price series");
  const jData = {
    uid: "FT040534",
    exch: "MCX",
    token: symbol_token,
    st: String(getPrevious9thDay().getTime() / 1000),
    intrv: "15",
  };

  try {
    const response = await axios.post(
      TP_SERIES,
      `jData=${JSON.stringify(jData)}&jKey=${jKey}`
    );
    console.log("Response from the TP series request successfull");
    return response;
  } catch (err) {
    console.log("Error in fetching the data from api", err);
  }
};

const filter_futures = (data) => {
  let res = [];
  for (let i = 0; i < data.length; i++) {
    const symbol = data[i];
    if (symbol["instname"] === "FUTCOM") {
      res.push(symbol);
    }
  }
  return res;
};

const get_atm = (last_close) => {
  const ltp = parseInt(last_close);
  const mod = ltp % 100;
  let atmStrike = -1;

  if (mod < 50) {
    atmStrike = parseInt(Math.floor(ltp / 100)) * 100;
  } else {
    atmStrike = parseInt(Math.ceil(ltp / 100)) * 100;
  }
  return atmStrike;
};

const check_for_natgas_in_positions = (data) => {
  if (data === null || data === undefined) {
    return false;
  }
  // console.log("data in check_for_natgas_in_positions ---====",data);
  if (data?.length === 0) return false;
  // console.log("after if check of length ========++++++++++++++++++++++");
  for (let i = 0; i < data.length; i++) {
    console.log("index ======", i, "data here +++++++---------", data[i]);
    // console.log("data?.[i]?.tsym.slice(0,7) ======---------",data?.[i]?.tsym.slice(0,7),typeof data?.[i]?.tsym.slice(0,7));
    // console.log("data?.[i]?.netqty =========----------",data?.[i]?.netqty,typeof data?.[i]?.netqty);
    if (data?.[i]?.tsym.slice(0, 6) === "NATGAS" && data?.[i]?.netqty !== "0") {
      console.log("has natgas here =====-------", data?.[i]);
      return true;
    }
  }
  return false;
};

const check_for_exit = async (token, curr_qty, tsym) => {
  await putLog("in check for exit");
  console.log("in check for exit");
  console.log("tsym to be checked for >>>>>>>>>>>>>>",tsym);
  console.log(
    "curr_qty conditions check +++++++++_____________",
    curr_qty > 0,
    curr_qty < 0
  );
  // const resp = await search_script("NATGASMINI", token);
  // const filtered_response = filter_futures(resp?.data?.values);
  // let x = 1;
  // let get_fut_obj = get_next_x_fut(filtered_response, "NATGASMINI", x);
  // let cnt = 0;
  // while (cnt <= 25 && Object.keys(get_fut_obj).length === 0) {
  //   x += 1;
  //   cnt += 1;
  //   get_fut_obj = get_next_x_fut(filtered_response, "NATGASMINI", x);
  // }
  // console.log("get_fut_obj,, exit--", get_fut_obj);
  // console.log("get_fut_obj", get_fut_obj);
  // const symbol_token = get_fut_obj[0].token;
  const response = await get_time_price_series(tsym, token);
  let close = [];
  let high = [];
  let low = [];
  let last_close = parseInt(response["data"][0]["intc"]);
  let atmStrike = get_atm(last_close);
  console.log("atmStrike exit condition", atmStrike);
  console.log("last close here ->>>>>>>>>>>>>>>>>>>>>>>>>>",last_close);
  for (let i = 0; i < response["data"].length; i++) {
    close.push(response["data"][i]["intc"]);
    high.push(response["data"][i]["inth"]);
    low.push(response["data"][i]["intl"]);
  }
  let converted = close.map((val) => parseInt(val));
  let converted_high = high.map((val) => parseInt(val));
  let converted_low = low.map((val) => parseInt(val));

  converted.reverse();
  converted_high.reverse();
  converted_low.reverse();

  const rsi = await get_rsi(converted, 14);
  const ema15 = await get_ema(converted, 15);
  const ema9 = await get_ema(converted,9);
  const aroon = await get_aroon(converted_high, converted_low, 14);
  const aroonDown = aroon[0];
  const aroonUp = aroon[1];
  console.log("ema9[0] ->>>>>>>>>>>>>>>>>>>>>>>>>>>>>",ema9[0]);

  if (curr_qty > 0 && last_close < ema15[0]) {
    // console.log("place exit order for long");
    // const fut_list = await search_script("NATGASMINI", token);
    // console.log("futures list", fut_list["data"]["values"]);
    // const resp_filtered = filter_futures(fut_list["data"]["values"]);
    // console.log("resp_filtered", resp_filtered);
    // let x = 1;
    // let f_obj = get_next_x_fut(resp_filtered, "NATGASMINI", x);
    // let cnt = 0;
    // while (cnt <= 25 && Object.keys(f_obj).length === 0) {
    //   x += 1;
    //   cnt += 1;
    //   f_obj = get_next_x_fut(resp_filtered, "NATGASMINI", x);
    // }
    // const order_token = f_obj[0]["tsym"];
    // console.log("order_token ", order_token);

    const order_response = await place_order(tsym, token, -1,QTY);
    if(order_response?.data?.stat?.toLowerCase() == "ok") hasPosition = false;
    await putLog("in long position exit here >>>>>>>>>>>>>>>>>>>>");
    console.log("long exit order response", order_response);
  } else if (curr_qty < 0 && last_close > ema15[0]) {
    // console.log("place exit order for short");
    // const fut_list = await search_script("NATGASMINI", token);
    // console.log("futures list", fut_list["data"]["values"]);
    // const resp_filtered = filter_futures(fut_list["data"]["values"]);
    // console.log("resp_filtered", resp_filtered);
    // let x = 1;
    // let f_obj = get_next_x_fut(resp_filtered, "NATGASMINI", x);
    // let cnt = 0;
    // while (cnt <= 25 && Object.keys(f_obj).length === 0) {
    //   x += 1;
    //   cnt += 1;
    //   f_obj = get_next_x_fut(resp_filtered, "NATGASMINI", x);
    // }
    // const order_token = f_obj[0]["tsym"];
    // console.log("order_token ", order_token);

    const order_response = await place_order(tsym, token, 1,QTY);
    if(order_response?.data?.stat?.toLowerCase() == "ok") hasPosition = false;
    await putLog("in exit for short position >>>>>>>>>>>");
    console.log("short exit order response", order_response);
  } else {
    await putLog('no exit condition triggered ----->>>>>>>>');
    console.log("modify the sl order ->>>>>>>>>>>>>>>>>>>>>>>>>");
    //logic to modify the orders here
    const query = {
      tsym,
      token,
      account: "FT040534",
      jKey: token
    }
    const url = `${appBaseUrl}${appPlaceOrder}?${new URLSearchParams(query)}`;
    const resp = await axios.post(`${appBaseUrl}${appModifySlOrder}?${new URLSearchParams(query)}`,{
      newPrice: ema9[0],
      last_close,
      curr_qty
    })
    
    console.log("resp from modify sl order -------",resp?.data);
    console.log("no exit condition triggered");
  }
};

const check_for_entry = async (token) => {
  await putLog("in check for entry");
  console.log("in check for entry");
  const resp = await search_script("NATGASMINI", token);
//   console.log("response from search_script ", resp?.data?.values);
  const filtered_response = filter_futures(resp?.data?.values);
  //   console.log("filtered_response", filtered_response);
  let x = 1;
  let get_fut_obj = get_next_x_fut(filtered_response, "NATGASMINI", x);
  let cnt = 0;
  while (cnt <= 25 && Object.keys(get_fut_obj).length === 0) {
    cnt += 1;
    x += 1;
    get_fut_obj = get_next_x_fut(filtered_response, "NATGASMINI", x);
  }
  if (Object.keys(get_fut_obj).length === 0) {
    console.log("no futures object found");
    return;
  }
  console.log("get_fut_obj after x iterations ---", x, cnt, get_fut_obj);
  const symbol_token = get_fut_obj[0].token;
  const response = await get_time_price_series(symbol_token, token);
  await putLog("fetched time price series ");
  // console.log("response from time price series", response['data']);
   if(response['data']['stat'] === "Not_Ok"){
       console.log("error in tp series request // try changing the tsym or the above index used ");
       return;
   }

  let close = [];
  let high = [];
  let low = [];
  let last_close = parseInt(response["data"][0]["intc"]);
  let atmStrike = get_atm(last_close);
  console.log("atmStrike entry condition", atmStrike);
  for (let i = 0; i < response["data"].length; i++) {
    close.push(response["data"][i]["intc"]);
    high.push(response["data"][i]["inth"]);
    low.push(response["data"][i]["intl"]);
  }
  let converted = close.map((val) => parseInt(val));
  let converted_high = high.map((val) => parseInt(val));
  let converted_low = low.map((val) => parseInt(val));

  converted.reverse();
  converted_high.reverse();
  converted_low.reverse();

  const rsi = await get_rsi(converted, 14);
  const ema15 = await get_ema(converted, 15);
  const ema9 = await get_ema(converted, 9);
  const aroon = await get_aroon(converted_high, converted_low, 14);
  const aroonDown = aroon[0];
  const aroonUp = aroon[1];

  //test by searching crudeoilm
  // const fut_list_m = await search_script("CRUDEOILM", token);
  // console.log("futures list for crudeoilm is -----==========", fut_list_m["data"]["values"]);

  console.log("last_close, ema15[0], rsi[0], aroonUp[0],aroonDown[0]");
  console.log("last_close =====----", last_close);
  console.log("ema15[0] =======------", ema15[0]);
  console.log("ema9[0] ========----------",ema9[0]);
  console.log("rsi[0] ======---------", rsi[0]);
  console.log("aroonUp[0] =======-----------", aroonUp[0]);
  console.log("aroonDown[0] ========---------", aroonDown[0]);
  console.log("before checks in entry ---------");
  const data={
    last_close: last_close,
    ema: ema15[0],
    rsi: rsi[0],
    aroonUp: aroonUp[0],
    aroonDown: aroonDown[0]
  }
  await putLog(JSON.stringify(data));
  //&& rsi[0] >= 60
  if (last_close > ema15[0] && rsi[0] >= 60) {
    await putLog("long entry here ------->>>>>>>>>");
    console.log("place buy order");
    const fut_list = await search_script("NATGASMINI", token);
    // console.log("futures list", fut_list["data"]["values"]);
    const resp_filtered = filter_futures(fut_list["data"]["values"]);
    // console.log("resp_filtered", resp_filtered);
    let x = 1;
    let f_obj = get_next_x_fut(resp_filtered, "NATGASMINI", x);
    let cnt = 0;
    while (cnt <= 25 && Object.keys(f_obj).length === 0) {
      cnt += 1;
      x += 1;
      f_obj = get_next_x_fut(resp_filtered, "NATGASMINI", x);
    }
    const order_token = f_obj[0]["tsym"];
    console.log("order_token ", order_token);

    const order_response = await place_order(order_token, token, 1, QTY);
    if(order_response?.data?.stat?.toLowerCase() == "ok") hasPosition = true;
    console.log("order response", order_response["data"]);
    const {norenordno,stat} = order_response["data"];
    if(stat === "Ok" || stat === "OK"){
      //place sl order here by the api or websocket -----
      
    }
    //&& rsi[0] <= 40
  } else if (last_close < ema15[0] && rsi[0] <= 40 ) {
    await putLog("short entry here ------->>>>>>>>");
    console.log("place sell order");
    const fut_list = await search_script("NATGASMINI", token);
    // console.log("futures list", fut_list["data"]["values"]);
    const resp_filtered = filter_futures(fut_list["data"]["values"]);
    // console.log("resp_filtered", resp_filtered);
    let x = 1;
    let f_obj = get_next_x_fut(resp_filtered, "NATGASMINI", x);
    let cnt = 0;
    while (cnt <= 25 && Object.keys(f_obj).length === 0) {
      x += 1;
      cnt += 1;
      f_obj = get_next_x_fut(resp_filtered, "NATGASMINI", x);
    }
    const order_token = f_obj[0]["tsym"];
    console.log("order_token ", order_token);

    const order_response = await place_order(order_token, token, -1, QTY);
    if(order_response?.data?.stat?.toLowerCase() == "ok") hasPosition = true;
    console.log("order response", order_response["data"]);
  } else {
    await putLog("no direction boss ----->>>>>>>");
    console.log("no direction");
  }
};

const start = async () => {
  try {
    console.log("starts  here -----------");
    const params = {
      TableName: "API_KEYS",
      Key: {
        api_key: "9",
      },
    };
    
    timeNow = moment.utc();
    let timeInIst = utcNow.tz('Asia/Kolkata');
    if(timeInIst.hourse() == 23 && timeInIst.minutes() == 30){
      axios.post("")
    }
    
    console.log('Current Indian Standard Time (IST):', istNow.format('YYYY-MM-DD HH:mm:ss'));
    putLog(`Current time in IST is ------>>>>>>>>>>>> ${istNow.format('YYYY-MM-DD HH:mm:ss')}`);
    const result = await dynamodb.get(params).promise();
    console.log("api key is ", result.Item);
    await putLog(`api key is ----- ${result}`);
    // Process the retrieved item as needed
    const token = result.Item.key;
    gToken = token;

    ws.send(JSON.stringify({
          t: Types.Connection,
          uid: userId,
          pwd: password,
          actid: userId,
          susertoken: gToken,
          source: source,
        }));
    

    console.log("gToken here -----", gToken);
    console.log("token here -------", token);
    const positions = await get_positions(token);
    const has_natgas_in_positions = check_for_natgas_in_positions(
      positions?.data
    );
    console.log(
      "has_nathas_in_positions ------>>>>>>>>>>",
      has_natgas_in_positions
    );

    await putLog(`has_natgas_in_positions --------->>>>>>>>>>> ${has_natgas_in_positions}`);
    if (positions?.data?.stat === "Not_Ok" || !has_natgas_in_positions) {
      console.log("inside check for entry----------");
      await check_for_entry(token);
    } else {
      console.log("in check for exit-----------", positions?.data);
      let curr_qty = 0;
      let tsym = "";
      for (let i = 0; i < positions?.data?.length; i++) {
        if (positions?.data?.[i]?.tsym.slice(0, 6) === "NATGAS") {
          curr_qty = positions?.data?.[i]?.netqty;
          tsym = positions?.data?.[i]?.tsym;

          console.log("tsym of the symbol boss ------",tsym);
          //can get token also directly from the response and use this to place order(sl/exit)
          break;
        }
      }
      console.log("curr_qty in exit ++++++++++____________", curr_qty);
      await check_for_exit(token, curr_qty,tsym);
    }
  } catch (e) {
    console.log("error here bosss -------", e);
  }
};

//starts here



cron.schedule("*/15 * * * *", () => {
  // Your script logic here
  console.log("executed here at time --------", new Date().getTime());
  const now = new Date();
  const hh = now.getHours();
  const mm = now.getMinutes();
  const ss = now.getSeconds();

  console.log("websocket state here ------", ws.readyState);

  console.log("time here ------", hh, mm, ss);
  putLog("executed at this time -----",new Date());
  start();
});


// const params = {
//   QueueUrl: 'https://sqs.us-east-1.amazonaws.com/741879316627/orderUpdates',
//   MaxNumberOfMessages: 10,  // Adjust as needed
//   WaitTimeSeconds: 20        // Adjust as needed
// };

// const pollQueue = async () => {
//   console.log("in poll queue boss ---->>>>>>>>>");
//   try {
//     const data = await sqs.receiveMessage(params).promise();

//     if (data.Messages) {
//       // Process each message
//       for (const message of data.Messages) {
//         console.log("-----------------_>>>>>>>>>>>>>>>>>>>>>>>");
//         console.log("Received message:", message.Body);
//         putLog("Recieved message from sqs ------")
        
//         const data = message?.Body;
//         if(data === "NATGASMINI"){
//           putLog("closing all positions bosss --------=================----------");
//           const deleteParams = {
//           QueueUrl: params.QueueUrl,
//           ReceiptHandle: message.ReceiptHandle
//         };
//         await sqs.deleteMessage(deleteParams).promise();
//         console.log("Message deleted:", message.MessageId);
//         }
//         // Delete the message from the queue
       
//       }
//     } else {
//       console.log("No messages in the queue.");
//     }
//   } catch (error) {
//     console.error("Error polling queue:", error);
//   }
// };

// // Set up an interval to poll the queue every 10 seconds
// const interval = setInterval(pollQueue, 5000);


// start();

ws.on("open", () => {
  console.log("connection opened");
  //here boss
  /*
  get the keys from redis to subscribe
  */

  setInterval(() => {
    console.log("send ping event ----");
    ws.ping();
  }, 5000);
  
  // ws.send(JSON.stringify({
  //         t: Types.Details,
  //         k: "NSE|22#MCX|1223",
  //       }));
});

ws.on('pong', function pong() {
  console.log('Received pong');
});

ws.on("message", async (data) => {
  let parsedData = data.toString("utf8");
  console.log("parsedData here ------", parsedData);
  parsedData = JSON.parse(parsedData);
  const {t,status} = parsedData;
  console.log("t,status -----",t,status);
  if(t == "om" && status == "COMPLETE"){
    //place sl order ------
    const {tsym,exch,qty,avgprc,trantype,prctyp} = parsedData;
    try{
      if(!prctyp.includes("SL") && !hasPosition){
        const dir = trantype == "B" ? -1: 1;
        console.log("typeof avgprc -----",typeof avgprc);
        const sl_price = trantype == "B" ? parseFloat(avgprc) - 2.0 : parseFloat(avgprc) + 2.0;
        console.log("before place sl order --------",dir,sl_price);
        const resp = await place_order(tsym,gToken,dir,String(qty/250),true,String(sl_price));
        console.log("resp{data} in sl order ----",resp?.data);
        putLog(JSON.string(resp?.data));
      }
      else{
        console.log("that was a sl order, completed ------>>>>>>>>>>>");
        hasPosition = false;
      }
      
      
    }
    catch(e){
      console.log("Error while placing sl order",e);
    }
    
  }
  // await putLog("parsed Data from the websocket event of place order. ");
  // await putLog(JSON.stringify(parsedData));
  // const {prc,status,tsym,qty,trantype,exch} = parsedData || {};

  // if(status === "COMPLETE" && tsym && qty !== ""){
  //   console.log("order placed successfully");
  //   const sl_response = place_order(tsym,gToken,trantype === "S" ? "B":"S",qty);

    // const {order_id} = sl_response["data"];
    // slOrderId = order_id;

    // use this order id to trail for the successive iterations

    //get the prc/avg price and place at price - 2
    //store the order id of the
  // }


  /*
  check for status here, only if it is OK/Success place the slorder with same gToken and the tsym, with the price needed to trigger for

  store the sl orders orderno in golbal state, check for the type of the order (has to be SL-L or SL-M)
  store this orderno, to modify, get the price calculation from the same tsym's ema values, have to be after all the computations in check for exit

  */
//   if(status === ORD)
});

ws.on("error", (data) => {
  console.log("error in websocket connection --------", data);
});

ws.on("close", (data) => {
  console.log("websocket connection closed  --------", data);
});
