# StockWise Signal Line (Classic) - thinkorswim study (thinkScript). The original version: one line that changes color.
# https://lebron2004.github.io/investing/#/tools
#
# HOW TO READ IT
#   Green line UNDER the candles  -> uptrend: HOLD. The line is your trailing stop-loss.
#   Red line ABOVE the candles    -> downtrend: SELL / stay out.
#   BUY bubble   -> the line just flipped up (and price is above its 200-bar average).
#   WAIT bubble  -> flipped up, but the long-term trend is still down: be careful.
#   SELL bubble  -> the line just flipped down. Exit or tighten up.
#   Labels at the top-left show the current status and stop price.
#
# TURN IT ON / OFF: Charts -> Studies -> Edit Studies -> select "StockWise_Signal_Line" -> remove,
# or uncheck "Show study" in its settings (gear icon). Re-add it from the studies list anytime.
#
# Educational tool, not financial advice.

input atrLength = 14;
input multiplier = 3.0;
input useTrendFilter = yes;
input trendLength = 200;
input showBubbles = yes;
input showMovingAverages = no;

def mid = (high + low) / 2;
def atrValue = WildersAverage(TrueRange(high, close, low), atrLength);
def basicUpper = mid + multiplier * atrValue;
def basicLower = mid - multiplier * atrValue;

def bandUp = CompoundValue(1, if basicUpper < bandUp[1] or close[1] > bandUp[1] then basicUpper else bandUp[1], basicUpper);
def bandDown = CompoundValue(1, if basicLower > bandDown[1] or close[1] < bandDown[1] then basicLower else bandDown[1], basicLower);

# 1 = uptrend, -1 = downtrend (starts in a downtrend, like TradingView)
def dir = CompoundValue(1, if dir[1] == -1 and close > bandUp then 1 else if dir[1] == 1 and close < bandDown then -1 else dir[1], -1);

def sigLine = if dir == 1 then bandDown else bandUp;
def trendMA = Average(close, trendLength);
def trendOk = useTrendFilter == no or close > trendMA;
def flipUp = dir == 1 and dir[1] == -1;
def flipDown = dir == -1 and dir[1] == 1;
def rsiValue = RSI(length = 14);

plot SignalLine = sigLine;
SignalLine.SetLineWeight(2);
SignalLine.AssignValueColor(if dir == 1 then Color.GREEN else Color.RED);
SignalLine.SetPaintingStrategy(PaintingStrategy.LINE);

plot BuyArrow = if flipUp and trendOk then low else Double.NaN;
BuyArrow.SetPaintingStrategy(PaintingStrategy.ARROW_UP);
BuyArrow.SetDefaultColor(Color.GREEN);
BuyArrow.SetLineWeight(3);

plot SellArrow = if flipDown then high else Double.NaN;
SellArrow.SetPaintingStrategy(PaintingStrategy.ARROW_DOWN);
SellArrow.SetDefaultColor(Color.RED);
SellArrow.SetLineWeight(3);

plot WaitArrow = if flipUp and trendOk == 0 then low else Double.NaN;
WaitArrow.SetPaintingStrategy(PaintingStrategy.ARROW_UP);
WaitArrow.SetDefaultColor(Color.GRAY);

plot Overheated = if dir == 1 and rsiValue > 75 and rsiValue[1] <= 75 then high else Double.NaN;
Overheated.SetPaintingStrategy(PaintingStrategy.POINTS);
Overheated.SetDefaultColor(Color.ORANGE);
Overheated.SetLineWeight(4);

AddChartBubble(showBubbles and flipUp and trendOk, low, "BUY", Color.GREEN, no);
AddChartBubble(showBubbles and flipUp and trendOk == 0, low, "WAIT", Color.GRAY, no);
AddChartBubble(showBubbles and flipDown, high, "SELL", Color.RED, yes);

AddLabel(yes,
    "StockWise: " + (if dir == 1 then (if trendOk then "HOLD" else "HOLD (weak trend)") else "SELL / STAY OUT"),
    if dir == 1 then (if trendOk then Color.GREEN else Color.ORANGE) else Color.RED);
AddLabel(yes, (if dir == 1 then "Stop: " else "Flips up above: ") + AsDollars(sigLine), Color.GRAY);

plot MA20 = if showMovingAverages then Average(close, 20) else Double.NaN;
MA20.SetDefaultColor(Color.CYAN);
plot MA50 = if showMovingAverages then Average(close, 50) else Double.NaN;
MA50.SetDefaultColor(Color.YELLOW);
plot MA200 = if showMovingAverages then trendMA else Double.NaN;
MA200.SetDefaultColor(Color.MAGENTA);

Alert(flipUp and trendOk, "StockWise BUY", Alert.BAR, Sound.Ding);
Alert(flipDown, "StockWise SELL", Alert.BAR, Sound.Bell);
