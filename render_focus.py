#!/usr/bin/env python

import sys
import math
import json
import numpy as np
import cv2

# try to make sure the referenced memory region in each round will not be swapped to disk
max_round_size = 512 * (1024 ** 2) / 4 # ~512MiB memory

def gendata(record, size, mapped_size=None):
	w, h = size
	out = np.zeros((h, w), dtype=np.float)

	invmap_factor = 1, 1
	if mapped_size is not None:
		invmap_factor = size[0] / mapped_size[0], size[1] / mapped_size[1]

	# TODO: when w > max_round_size, optimize by spliting colomns

	max_rows_in_round = math.ceil(max_round_size / w)

	print('generating focus image')

	for cur_row in range(0, h, max_rows_in_round):
		print('{:.1%}'.format(cur_row / h))

		l, r = 0, w
		t, b = cur_row, min(max_round_size, cur_row + max_rows_in_round)

		for rec in record:
			x1 = rec['sx'] * invmap_factor[0]
			y1 = rec['sy'] * invmap_factor[1]
			sw = rec['sw'] * invmap_factor[0]
			sh = rec['sh'] * invmap_factor[1]
			x2 = x1 + sw
			y2 = y1 + sh
			x1 = int(max(x1, l))
			y1 = int(max(y1, t))
			x2 = int(min(x2, r))
			y2 = int(min(y2, b))
			out[y1:y2, x1:x2] += 1. / (sw * sh)

	print('{:.1%}'.format(1))

	print('collecting statistics')

	mi = np.min(out)
	ma = np.max(out)

	max_rows_in_round = math.ceil(max_round_size / w)

	print('normalizing foucs image')

	for cur_row in range(0, h, max_rows_in_round):
		print('{:.1%}'.format(cur_row / h))

		t, b = cur_row, min(max_round_size, cur_row + max_rows_in_round)
		out[:, t:b] = (out[:, t:b] - mi) * (255 / ma)

	print('{:.1%}'.format(1))

	return out.astype(np.uint8), (mi, ma)

def genpreview(bgimg, overlay, discard_raw_overlay = True, overlay_alpha = 0.6, colormap=cv2.COLORMAP_MAGMA):
	(h, w, *_) = bgimg.shape
	target_size = w, h

	print('Overlay: {:.2F}MiB'.format(overlay.nbytes / 1048576))

	overlay = overlay

	ovl = cv2.resize(overlay, target_size)

	if discard_raw_overlay:
		del overlay

	print('Truncated to {:.2F}MiB'.format(ovl.nbytes / 1048576))

	if len(ovl.shape) > 2:
		ovl = ovl[:,:,0]

	ovlrender = cv2.applyColorMap(ovl, colormap)

	return cv2.addWeighted(bgimg, 1 - overlay_alpha, ovlrender, overlay_alpha, 0)

def calc_target_size(w, h, scale, maxsize, minsize):
	if scale is None:
		if maxsize is None:
			if minsize is None:
				raise Exception('At least one of three parameters (scale, maxsize, minsize) must be set.')
			else:
				target_size = minsize
		else:
			target_size = maxsize
	else:
		target_size = w * scale[0], h * scale[1]
	if minsize is not None:
		target_size = max(target_size[0], minsize[0]), max(target_size[1], minsize[1])
	if maxsize is not None:
		target_size = min(target_size[0], maxsize[0]), min(target_size[1], maxsize[1])
	target_size = int(target_size[0]), int(target_size[1])

	return target_size

def gencolormap(record, img, outimg, outpreview, imgformat=None, scale=(0.25, 0.25), maxsize=(1024, 1024), minsize=None, no_overwrite_focus=False, **kwargs):
	with open(record, 'r') as f:
		record_data = json.load(f)
		if img is None:
			img = record_data['tile_path']
		record_data = record_data['focus_history']

	print('use record', record)
	print('use tile', img)
	print('output to', outimg)

	if imgformat is None:
		if img[-4:] == '.svs':
			imgformat = 'svs'
		else:
			imgformat = 'cv2'

	if imgformat == 'cv2':
		img_data = cv2.imread(img)
		(h, w, *_) = img_data.shape

		target_size = calc_target_size(w, h, scale, maxsize, minsize)

		img_thumbnail = cv2.resize(img_data, target_size)
		del img_data

		record_w, record_h = w, h

	elif imgformat == 'svs':
		from openslide import OpenSlide
		img_data = OpenSlide(img)
		w, h = img_data.level_dimensions[0]

		target_size = calc_target_size(w, h, scale, maxsize, minsize)

		img_thumbnail = img_data.get_thumbnail(target_size)
		img_thumbnail = cv2.cvtColor(np.array(img_thumbnail), cv2.COLOR_RGB2BGR)

		record_w, record_h = img_data.level_dimensions[-1]

		img_data.close()
		del img_data

	else:
		raise Exception('Unimplemented image format {}'.format(imgformat))

	# intermediate layer (w, h, img_thumbnail, record_data)

	out_img = None
	if no_overwrite_focus:
		try:
			out_img = cv2.imread(outimg)
			print(out_img.shape)
			print('Using existed focus density...')
		except:
			pass
	if out_img is None:
		out_img, (mi, ma) = gendata(record_data, (w, h), (record_w, record_h))
		print(out_img.shape)

		with open(outimg + '.meta.json', 'w') as f:
			json.dump({'min': mi, 'max': ma}, f)
		cv2.imwrite(outimg, out_img)

	preview_data = genpreview(img_thumbnail, out_img, discard_raw_overlay=True, **kwargs)

	cv2.imwrite(outpreview, preview_data)

	return preview_data

if __name__ == '__main__':
	from sys import argv
	if len(argv) not in [2, 3]:
		print('Usage: {} <focus_history> [baseimage]'.format(argv[0]))
		exit(1)
	baseimg = argv[2] if len(argv) >= 3 else None
	focus_history = argv[1]
	preview = gencolormap(focus_history, baseimg, focus_history + '_focus.png', focus_history + '_render.png', no_overwrite_focus=True)
	# preview = cv2.imread('out_focus.png')

	cv2.imshow('preview', preview)

	while cv2.getWindowProperty('preview', cv2.WND_PROP_VISIBLE) != 0:
		k = cv2.waitKey(100)
		if k not in [-1, 225, 233]:
			break

