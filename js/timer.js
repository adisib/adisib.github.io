
"use strict";

// TODO: Other timers besides countdown
// TODO: Specify thresholds for background change?
// TODO: Key-press shortcuts (at least for pause?)
// TODO: Allow customizing update interval (and by extension timer resolution) in page display?
// TODO: Timer should allow user to specify its standard time unit?
// TODO: Play a sound when timer completes?
// TODO: Split the class timers away from page code
// TODO: Clean page code

// ----- Timer Class -----

// A countdown timer with a resolution of milliseconds (resolution might be lower, depending on browser behavior to prevent timing attacks)
class CountdownTimer
{
	// UpdateIntervalMS specifies the target delay in milliseconds per update of the timer.
	//   Update speed is constrained by the browser, so actual update speed might be slower than desired.
	// onUpdateCallback is a function that will be called per update.
	// onCompleteCallback is a function that will be called upon the countdown timer finishing.
	constructor(updateIntervalMS, onUpdateCallback, onCompleteCallback)
	{
		// Note: This should be a static, but I can't declare statics inside the class definition, so I wont bother.
		this.statusList = {none: 0, unstarted: 1, started: 2, paused: 3, stopped: 4};

		this.updateInterval = updateIntervalMS;
		this.updateCallback = onUpdateCallback;
		this.completeCallback = onCompleteCallback;

		this.timerStatus = this.statusList.unstarted;

		this.remainingTimeMS = (0n);
		this.storedRemainingTime = (0n);
		this.currentStartTime = Date.now();
		this.timerInterval = null;
		this.intervalOffsetMS = (0n);
	}

	// Starts a new countdown timer starting at the specified total time in seconds, and ending at time=0
	start(startTimeSeconds)
	{
		if (this.timerStatus === this.statusList.started || this.timerStatus === this.statusList.paused)
		{
			// Stop the timer first to clear any old data
			this.stop();
		}

		this.remainingTimeMS = BigInt(startTimeSeconds) * 1000n;
		this.storedRemainingTime = this.remainingTimeMS;
		this.currentStartTime = Date.now();
		this.timerInterval = setInterval(function(obj) { obj.m_update(); }, parseInt(this.updateInterval), this);

		this.timerStatus = this.statusList.started;
	}

	// Stops ticking the timer and clears the timer's data
	stop()
	{
		if (this.timerStatus === this.statusList.started || this.timerStatus === this.statusList.paused)
		{
			clearInterval(this.timerInterval);
		}

		this.remainingTimeMS = 0n;
		this.storedRemainingTime = 0n;

		this.timerStatus = this.statusList.stopped;
	}

	// Stops ticking the timer but preserves current data so that it can be resumed.
	pause()
	{
		if (this.timerStatus === this.statusList.started)
		{
			clearInterval(this.timerInterval);

			// We have to track our progress into the update, so that there isn't time gain from pausing
			let newTimestamp = Date.now();
			this.storedRemainingTime -= newTimestamp - this.currentStartTime;
			this.intervalOffsetMS = this.remainingTimeMS - this.storedRemainingTime;

			this.timerStatus = this.statusList.paused;
		}
	}

	// Resumes the timer tick where it left off using its current data
	resume()
	{
		if (this.timerStatus === this.statusList.paused)
		{
			this.currentStartTime = Date.now();
			setTimeout( function(obj) {
				obj.timerInterval = setInterval(function(iobj) { iobj.m_update(); }, obj.updateInterval, obj);
				obj.m_update();
			}, this.intervalOffsetMS, this);

			this.timerStatus = this.statusList.started;
		}
	}

	// Returns the total time remaining in milliseconds
	getTimeRemaining()
	{
		return (this.remainingTimeMS);
	}

	m_update()
	{
		// We want to avoid using the remaining time in its calculation to avoid inaccuracy due to limited precision of our timer
		// e.g., if 1.01 ms passes in the case setInterval isn't extremely precise, we would only record 1 ms passing that update, giving us error that could eventually build up to be measureable.
		// So we avoid using our own updated remaining time to determine the remaining time (though we still do this upon pause/resume which doesn't happen often enough to matter).
		// I don't think this error would build up enough to be noticible in practice, but handle it anyway.
		let newTimestamp = Date.now();
		this.remainingTimeMS = this.storedRemainingTime - BigInt(newTimestamp - this.currentStartTime);

		if (this.remainingTimeMS < this.updateInterval)
		{
			if (this.remainingTimeMS <= 0n)
			{
				this.completeCallback();
				this.stop();
			}
			else
			{
				// Try to avoid waiting extra time after timer should expire for calling completeCallback
				// There can still be a delay on the callback due to browser throttling
				setTimeout(function(obj) {
					obj.completeCallback();
					obj.stop();
				}, this.remainingTimeMS, this);
			}
		}

		this.updateCallback();
	}
}


// ----- Timer Page Code -----

(function (){

const DEBUG = false;

const updateIntervalMS = 16n; // in Milliseconds
// we will do 16 to ensure an update on every refresh of a 60Hz display (though this doesn't guarantee each refresh is of equal size)
// It would be better if we could get the refresh rate and decide to adjust update rate accordingly, but I don't want to force us to use refresh rate with requestAnimationFrame.

// To avoid frequent DOM lookups wasting battery life, we will cache these page elements here
const background = document.getElementById("content");
const textDisplay = document.getElementById("time-display");

// Hard-coded for countdown timer for now
let startButton = document.getElementById("timer-start");
startButton.addEventListener("click", startCountdownTimer);

let stopButton = document.getElementById("timer-stop");
stopButton.addEventListener("click", endCountdownTimer);

let pauseButton = document.getElementById("timer-pause");
pauseButton.addEventListener("click", pauseCountdownTimer);

let resumeButton = document.getElementById("timer-resume");
resumeButton.addEventListener("click", resumeCountdownTimer);

let currentTimer;

function startCountdownTimer()
{
	let timeInput = document.getElementById("countdown-time");
	let inputInt = BigInt(timeInput.value);
	if (!inputInt)
	{
		// Invalid input, so don't start timer
		return;
	}

	let timerDiv = document.getElementById("timer");
	let configDiv = document.getElementById("config");
	timerDiv.classList.remove("hidden");
	configDiv.classList.add("hidden");

	currentTimer = new CountdownTimer(updateIntervalMS, updateDisplaysFromTimer, timerEndNotify);
	currentTimer.start(inputInt * 60n); // Minutes to Seconds
	debugLog("Timer Started");

	// Do immediate update
	updateDisplaysFromTimer();
}

// Pauses the countdown timer
function pauseCountdownTimer()
{
	if (currentTimer.getTimeRemaining() > 0n)
	{
		currentTimer.pause();
		background.classList.add("timer-paused");
		debugLog("Timer Paused");
	}
}

// Unpauses the countdown timer
function resumeCountdownTimer()
{
	if (currentTimer.getTimeRemaining() > 0n)
	{
		background.classList.remove("timer-paused");
		currentTimer.resume();
		debugLog("Timer Unpaused");
	}
}

// Stops timer and goes back to the configuration
function endCountdownTimer()
{
	currentTimer.stop();
	debugLog("Timer Exited");

	updateTextDisplay(0);

	let timerDiv = document.getElementById("timer");
	let configDiv = document.getElementById("config");
	timerDiv.classList.add("hidden");
	configDiv.classList.remove("hidden");
	background.classList.remove("timer-started", "timer-warn", "timer-paused", "timer-end");
}

function timerEndNotify()
{
	updateTextDisplay(0n);
	updateBackgroundDisplay(0n);
	debugLog("Timer Ended");
	// Play a sound?
}

// Updates the page to display the current time
function updateDisplaysFromTimer()
{
	let MSRemaining = currentTimer.getTimeRemaining();

	updateTextDisplay(MSRemaining);
	updateBackgroundDisplay(MSRemaining);
}

// Updates the time text for a millisecond timer
function updateTextDisplay(timeInMilliseconds)
{
	// Probably a better way to do this, but whatever. Can be changed later.

	if (textDisplay)
	{
		let timeVal = BigInt(timeInMilliseconds);
		let centiseconds = ((timeVal % 1000n) / 10n); timeVal /= 1000n;
		let seconds = (timeVal % 60n); timeVal /= 60n;
		let minutes = (timeVal % 60n); timeVal /= 60n;
		let hours = (timeVal % 60n); timeVal /= 60n;
		let days = (timeVal / 24n); 
		textDisplay.textContent = `${numToTwoDigitStr(days)}:${numToTwoDigitStr(hours)}:${numToTwoDigitStr(minutes)}:${numToTwoDigitStr(seconds)}:${numToTwoDigitStr(centiseconds)}`;
	}
}

function updateBackgroundDisplay(timeInMilliseconds)
{
	// TODO: Don't hardcode color thresholds
	// For now this only changes color for time status, and other functions might change the color for other reasons.
	if (background)
	{
		if (timeInMilliseconds < 60000n)
		{
			if (timeInMilliseconds <= 0n)
			{
				background.classList.add("timer-end");
			}
			else
			{
				background.classList.add("timer-warn");
			}
		}
		else
		{
			background.classList.add("timer-started");
		}
	}
}

// Because the nice ways to do this are poorly supported...
function numToTwoDigitStr(num)
{
	if (num < 10n)
	{
		return '0' + num;
	}
	return num;
}

function debugLog(message)
{
	if (DEBUG)
	{
		console.log(message);
	}
}

})(); //
