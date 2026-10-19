# StockWise Zones - optional add-on study for thinkorswim (thinkScript)
# https://lebron2004.github.io/investing/#/tools
#
# Add this ALONG WITH "StockWise_Signal_Line". It uses the same rules and adds:
#   - light green shading between the line and price in an uptrend (hold zone)
#   - light red shading in a downtrend (stay-out zone)
#   - optional: candles colored green / red by trend (paintCandles setting)
# It's a separate study so the main signal line keeps working even if you don't want these.
#
# Educational tool, not financial advice.

input atrLength = 14;
input multiplier = 3.0;
input showZones = yes;
input paintCandles = no;

def mid = (high + low) / 2;
def atrValue = WildersAverage(TrueRange(high, close, low), atrLength);
def basicUpper = mid + multiplier * atrValue;
def basicLower = mid - multiplier * atrValue;
def bandUp = CompoundValue(1, if basicUpper < bandUp[1] or close[1] > bandUp[1] then basicUpper else bandUp[1], basicUpper);
def bandDown = CompoundValue(1, if basicLower > bandDown[1] or close[1] < bandDown[1] then basicLower else bandDown[1], basicLower);
def dir = CompoundValue(1, if dir[1] == -1 and close > bandUp then 1 else if dir[1] == 1 and close < bandDown then -1 else dir[1], -1);
def sigLine = if dir == 1 then bandDown else bandUp;

# AddCloud can't take step-by-step ("recursive") values directly, so they go through hidden plots first.
plot HoldTop = if showZones and dir == 1 then close else Double.NaN;
plot HoldBottom = if showZones and dir == 1 then sigLine else Double.NaN;
plot OutTop = if showZones and dir == -1 then sigLine else Double.NaN;
plot OutBottom = if showZones and dir == -1 then close else Double.NaN;
HoldTop.Hide();
HoldBottom.Hide();
OutTop.Hide();
OutBottom.Hide();
AddCloud(HoldTop, HoldBottom, Color.DARK_GREEN, Color.DARK_GREEN);
AddCloud(OutTop, OutBottom, Color.DARK_RED, Color.DARK_RED);

AssignPriceColor(if paintCandles then (if dir == 1 then Color.GREEN else Color.RED) else Color.CURRENT);
