@echo off
setlocal
REM Run a command with the environment the Tironian Tauri crate needs on Windows.
REM
REM   scripts\windows-build-env.bat                 runs `bun run dev`
REM   scripts\windows-build-env.bat cargo build ... runs that instead
REM
REM Four settings, each one a hard build failure without it. None of them are
REM preferences.
REM
REM   1. MSVC. `cl.exe` is not on PATH in an ordinary shell, so CMake configures
REM      the vendored whisper.cpp and reports "No CMAKE_CXX_COMPILER could be
REM      found" before any first-party code compiles.
REM   2. Ninja. Under the Visual Studio generator, ggml-vulkan's nested
REM      vulkan-shaders-gen sub-build calls vcvarsall again and fails with "The
REM      system cannot find the batch label specified - VCEnd". Ninja has no
REM      nested call. The generator ships inside the VS install, so there is
REM      nothing to install.
REM   3. A short target directory. The vulkan-shaders-gen object paths run past
REM      the 250 character CMAKE_OBJECT_PATH_MAX under the repo's own target
REM      dir, and MSVC then fails with "Cannot open compiler generated file".
REM   4. CMAKE_POLICY_VERSION_MINIMUM. CMake 4 removed compatibility with
REM      cmake_minimum_required below 3.5, and the Opus that audiopus_sys
REM      vendors is below it.
REM
REM Set CARGO_TARGET_DIR yourself beforehand to override the short path this
REM picks. Keep whatever you choose near the root of a drive.

for %%I in ("%~dp0..\..\..") do set "REPO_ROOT=%%~fI"

REM Locate any Visual Studio install carrying the C++ toolset: Build Tools,
REM Community, Professional and Enterprise all answer here.
set "VSWHERE=%ProgramFiles(x86)%\Microsoft Visual Studio\Installer\vswhere.exe"
if not exist "%VSWHERE%" (
	echo(
	echo Visual Studio Installer not found at "%VSWHERE%".
	echo Install the Visual Studio Build Tools with the "Desktop development
	echo with C++" workload, then run this again.
	exit /b 1
)

set "VS_PATH="
for /f "usebackq tokens=*" %%I in (`"%VSWHERE%" -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath`) do set "VS_PATH=%%I"
if not defined VS_PATH (
	echo(
	echo No Visual Studio install has the C++ toolset.
	echo Add the "Desktop development with C++" workload, then run this again.
	exit /b 1
)

REM Silenced on both streams: vcvars64.bat writes its own unrelated complaint
REM about vswhere to stderr. The errorlevel below is what decides whether it
REM actually worked.
call "%VS_PATH%\VC\Auxiliary\Build\vcvars64.bat" >nul 2>nul
if errorlevel 1 (
	echo Could not initialise the MSVC environment from "%VS_PATH%".
	exit /b 1
)

set "NINJA_DIR=%VS_PATH%\Common7\IDE\CommonExtensions\Microsoft\CMake\Ninja"
if exist "%NINJA_DIR%\ninja.exe" (
	set "PATH=%NINJA_DIR%;%PATH%"
	set "CMAKE_GENERATOR=Ninja"
) else (
	where ninja >nul 2>&1
	if errorlevel 1 (
		echo(
		echo Ninja was not found, in the Visual Studio install or on PATH.
		echo The Visual Studio generator cannot build ggml-vulkan, so add the
		echo "C++ CMake tools for Windows" component or put ninja on PATH.
		exit /b 1
	)
	set "CMAKE_GENERATOR=Ninja"
)

REM The Vulkan backend needs the SDK's SPIRV-Headers CMake package. Recent SDKs
REM ship it under Lib\cmake; older ones need it from vcpkg, which is what
REM src-tauri\Cargo.toml's comment describes.
if defined VULKAN_SDK (
	set "CMAKE_PREFIX_PATH=%VULKAN_SDK%;%VULKAN_SDK%\Lib\cmake"
) else (
	echo(
	echo Warning: VULKAN_SDK is not set. Windows x64 builds pull transcribe-cpp
	echo with the vulkan feature, which needs the Vulkan SDK. Expect the ggml
	echo shader build to fail.
)

if not defined CARGO_TARGET_DIR set "CARGO_TARGET_DIR=%~d0\ct"
set "CMAKE_POLICY_VERSION_MINIMUM=3.5"

cd /d "%REPO_ROOT%\apps\desktop"

REM Branch with goto rather than if/else. With no arguments `%*` is empty, and an
REM empty parenthesised block is a cmd syntax error, so the else form fails on
REM exactly the no-argument path this script is normally used for.
if "%~1"=="" goto :dev
%*
exit /b %errorlevel%

:dev
bun run dev
