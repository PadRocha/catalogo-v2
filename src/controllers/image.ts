import { Request, Response } from 'express';
import { Types } from 'mongoose';
import fs from 'fs-extra';
import path from 'path';
import { v2 } from 'cloudinary';
import { config } from '../config/config';
import { KeyModel } from "../models/key";

v2.config({
    cloud_name: config.CLOUDINARY.NAME,
    api_key: config.CLOUDINARY.KEY,
    api_secret: config.CLOUDINARY.SECRET,
});

export async function updateImage({ user, params, file }: Request, res: Response) {
    if (!user?.roleIncludes(['EDIT', 'GRANT', 'ADMIN']))
        return res.status(423).send({ message: 'Access denied' });
    const idN = Number(params.idN);
    if (!Types.ObjectId.isValid(params?.key) || idN < 0 || idN > 2 || !file)
        return res.status(400).send({ message: 'Client has not sent params' });

    try {
        const cloudinary = await v2.uploader.upload(file.path, { folder: 'products' });
        const beforeUpdate = await KeyModel.findOne({
            _id: params.key,
            'image.idN': idN,
            'image.status': 5,
            'image.url': {
                $ne: null
            },
            'image.public_id': {
                $ne: null
            }
        }).select('image -_id');
        KeyModel.findOneAndUpdate({
            _id: params.key,
            'image.idN': idN,
            'image.status': 5,
            'image.url': {
                $ne: null
            },
            'image.public_id': {
                $ne: null
            }
        }, {
            $set: {
                'image.$.url': cloudinary.url,
                'image.$.public_id': cloudinary.public_id
            }
        }).exec(async (err, data) => {
            if (err) {
                await v2.uploader.destroy(cloudinary.public_id);
                await fs.unlink(file.path);
                return res.status(409).send({ message: 'Internal error, probably error with params' });
            }
            if (data) {
                if (beforeUpdate)
                    await v2.uploader.destroy(<string>beforeUpdate.image.find(x => x.idN === idN)?.public_id);
                await fs.unlink(file.path);
                return res.status(200).send({ data });
            } else
                KeyModel.findOneAndUpdate({
                    _id: params.key,
                    'image.idN': idN
                }, {
                    $set: {
                        'image.$.status': 5,
                        'image.$.url': cloudinary.url,
                        'image.$.public_id': cloudinary.public_id
                    }
                }, {
                    new: true
                }).exec(async (err, data) => {
                    if (err || !data) {
                        await v2.uploader.destroy(cloudinary.public_id);
                        await fs.unlink(file.path);
                    }
                    if (err)
                        return res.status(409).send({ message: 'Internal error, probably error with params' });
                    if (!data)
                        return res.status(404).send({ message: 'Document not found' });
                    await fs.unlink(file.path);
                    return res.status(200).send({ data });
                });
        });
    } catch {
        return res.status(409).send({ message: 'Internal error, probably error with params' });
    }
}

export function deleteImage({ user, params }: Request, res: Response) {
    if (!user?.roleIncludes(['GRANT', 'ADMIN']))
        return res.status(423).send({ message: 'Access denied' });
    const idN = Number(params.idN);
    if (!Types.ObjectId.isValid(params?.key) || idN < 0 || idN > 2)
        return res.status(400).send({ message: 'Client has not sent params' });

    KeyModel.findOneAndUpdate({
        _id: params.key
    }, {
        $pull: {
            image: {
                idN,
                status: 5
            }
        }
    }).exec(async (err, data) => {
        if (err)
            return res.status(409).send({ message: 'Internal error, probably error with params' });
        if (!data)
            return res.status(404).send({ message: 'Document not found' });
        await v2.uploader
            .destroy(<string>data.image.find(x => x.idN === idN)?.public_id)
            .catch(() => {
                return res.status(409).send({ message: 'Internal error, probably error with params' });
            });
        return res.status(200).send({ data });
    });
}